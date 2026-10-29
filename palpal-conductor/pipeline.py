import asyncio
import base64
import json
import logging
from datetime import datetime, timedelta, timezone

import asyncpg
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import analytics
import caches
import db
import pipeline_settings as settings
from activities.discovery import (
    get_enabled_sources_by_site, get_source,
    apply_discovery_results, apply_channel_icon,
)
from activities.process import process_transcript

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()
_dispatch_wakeup = asyncio.Event()
_dispatch_task: asyncio.Task | None = None
_consecutive_failures = 0

# Gates whether a worker can claim a 'process' job (see /worker/jobs/next).
# Deliberately independent of the APScheduler instance below — pausing this
# no longer stops the discovery cron or the stuck-job reclaim sweep, both of
# which should keep running regardless of whether processing is paused.
# In-memory source of truth; persisted to the 'processing_paused' setting
# only so it survives a conductor restart.
_processing_paused = False

# How often the dispatcher re-sweeps for discovered episodes even without an
# explicit wakeup — catches episodes reset by a rate-limit/backoff failure.
_SWEEP_INTERVAL_SECONDS = 300.0

DEFAULT_DISCOVERY_CRON = "0 */6 * * *"
_SCHEDULER_TIMEZONE = "America/Los_Angeles"


def wakeup_worker() -> None:
    """Signal the dispatcher to sweep for discovered episodes needing a process job."""
    _dispatch_wakeup.set()


async def _check_consecutive_failure(episode_id: str) -> None:
    """Increment the failure counter and auto-pause processing if threshold is hit."""
    global _consecutive_failures, _processing_paused
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT status FROM episodes WHERE id = $1::uuid", episode_id)
    if row and row["status"] == "failed":
        _consecutive_failures += 1
        if _consecutive_failures >= 5:
            logger.warning("Auto-pausing processing after %d consecutive failures", _consecutive_failures)
            _processing_paused = True
            await _persist_processing_paused(True)
            _consecutive_failures = 0
    else:
        _consecutive_failures = 0


# --------------------------------------------------------------------------- #
# Job creation                                                                 #
# --------------------------------------------------------------------------- #

async def _create_job(
    kind: str, payload: dict, *, episode_id: str | None = None, source_id: str | None = None,
) -> str:
    pool = db.get_pool()
    # payload goes through asyncpg's jsonb codec (db.py registers json.dumps/loads),
    # which encodes dicts automatically — dumping it here double-encodes it into a
    # jsonb string scalar instead of an object.
    #
    # episode_id/source_id are the real FK link to the job's target (exactly one
    # is set, enforced by jobs_target_matches_kind) — payload keeps its own copy
    # for the conductor<->blurb wire protocol, but episode_id/source_id are what
    # every DB-side "does this already have a job" check relies on now,
    # including the jobs_one_active_{process,discover}_per_{episode,source}
    # unique partial indexes. A violation there means a concurrent caller won
    # the race for the same target — callers should catch UniqueViolationError.
    row = await pool.fetchrow(
        """
        INSERT INTO jobs (kind, payload, episode_id, source_id)
        VALUES ($1, $2::jsonb, $3::uuid, $4::uuid)
        RETURNING id::text
        """,
        kind, payload, episode_id, source_id,
    )
    return row["id"]


async def cancel_process_job(episode_id: str, reason: str) -> None:
    """Cancel any pending/claimed process job for an episode (admin retry/retranscribe/delete)."""
    pool = db.get_pool()
    await pool.execute(
        """
        UPDATE jobs SET status='failed', error=$1
        WHERE kind='process' AND status IN ('pending','claimed')
          AND episode_id = $2::uuid
        """,
        reason, episode_id,
    )


async def cancel_jobs_for_source(source_id: str, reason: str) -> None:
    """
    Cancel any live discover job for a source and any live process job for
    its episodes. Call this *before* deleting the source (or its parent
    podcast) — jobs.source_id/episode_id are ON DELETE SET NULL, not CASCADE
    (see migration 037), so a bare cascade delete leaves those jobs sitting in
    the queue with a payload that points at ids which no longer resolve to
    anything. blurb still does the work and the result gets discarded on
    completion, but that's a wasted download/transcribe and a confusing
    failed-job entry for an episode that no longer exists.
    """
    pool = db.get_pool()
    await pool.execute(
        """
        UPDATE jobs SET status='failed', error=$1
        WHERE kind='discover' AND status IN ('pending','claimed')
          AND source_id = $2::uuid
        """,
        reason, source_id,
    )
    await pool.execute(
        """
        UPDATE jobs SET status='failed', error=$1
        WHERE kind='process' AND status IN ('pending','claimed')
          AND episode_id IN (SELECT id FROM episodes WHERE source_id = $2::uuid)
        """,
        reason, source_id,
    )


async def cancel_jobs_for_podcast(podcast_id: str, reason: str) -> None:
    """Same as cancel_jobs_for_source but for every source under a podcast —
    call before a podcast delete cascades through its sources and episodes."""
    pool = db.get_pool()
    await pool.execute(
        """
        UPDATE jobs SET status='failed', error=$1
        WHERE kind='discover' AND status IN ('pending','claimed')
          AND source_id IN (SELECT id FROM sources WHERE podcast_id = $2)
        """,
        reason, podcast_id,
    )
    await pool.execute(
        """
        UPDATE jobs SET status='failed', error=$1
        WHERE kind='process' AND status IN ('pending','claimed')
          AND episode_id IN (
              SELECT e.id FROM episodes e JOIN sources s ON s.id = e.source_id
              WHERE s.podcast_id = $2
          )
        """,
        reason, podcast_id,
    )


async def _enqueue_process_jobs(rows) -> int:
    """Create a 'process' job for each row (episode_id/video_id/site/source_url) and
    flip the episode to 'downloading'. Shared by the auto-dispatch sweep and by admin
    actions that force a specific episode through immediately.

    Rows are pre-filtered by the caller's NOT EXISTS check, but that check isn't
    atomic with this insert — the unique partial index on (episode_id) for live
    process jobs is the real guard against a duplicate, and a concurrent winner
    of that race is not an error, just a no-op for this row.
    """
    if not rows:
        return 0
    pool = db.get_pool()
    min_duration = await settings.get_int("min_episode_duration_seconds")
    created = 0
    for row in rows:
        try:
            await _create_job(
                "process",
                {
                    "episode_id": row["episode_id"],
                    "site": row["site"],
                    "video_id": row["video_id"],
                    "min_duration_seconds": min_duration,
                    # Only meaningful for RSS (blurb re-resolves the enclosure URL
                    # from this at download time); harmless no-op for other sites.
                    "url": row["source_url"],
                },
                episode_id=row["episode_id"],
            )
        except asyncpg.exceptions.UniqueViolationError:
            logger.info("Episode %s already has a live process job, skipping", row["episode_id"])
            continue
        await pool.execute(
            "UPDATE episodes SET status='downloading' WHERE id=$1::uuid", row["episode_id"]
        )
        created += 1
    if created:
        caches.bust_episodes_cache()
    return created


async def sync_process_jobs() -> int:
    """
    Create a 'process' job for every 'discovered' episode that doesn't already
    have one pending/claimed. Idempotent — safe to call after discovery
    completes, after an admin action, or from the periodic sweep. Returns the
    number of jobs created.

    Excludes blank-title episodes — a title-less entry means the source
    listed it as private/unfetchable (see apply_discovery_results), so it can
    never actually download; dispatching it just burns a doomed job and, if
    it keeps happening, chips away at the consecutive-failure auto-pause.
    Discovery stopped inserting these going forward, but leftover rows from
    before that fix (anything not already swept by migration 038) can still
    be sitting in 'discovered'.

    This is the *automatic* dispatch path, so it respects the auto_download
    toggle. Admin actions that target a specific episode (process/retry/
    retranscribe) use queue_episodes_for_processing() instead, which bypasses
    this toggle — those are explicit requests, not automatic behavior, and
    should never silently no-op just because auto-dispatch is paused.
    """
    if not await settings.get("auto_download"):
        return 0

    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT e.id::text AS episode_id, e.video_id, s.site, s.url AS source_url
        FROM episodes e
        JOIN sources s ON s.id = e.source_id
        JOIN podcasts p ON s.podcast_id = p.id
        WHERE e.status = 'discovered' AND e.blacklisted = FALSE AND e.title != ''
          AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.kind = 'process' AND j.status IN ('pending', 'claimed')
                AND j.episode_id = e.id
          )
        ORDER BY p.priority DESC, p.display_order ASC, e.created_at DESC
        """
    )
    n = await _enqueue_process_jobs(rows)
    if n:
        logger.info(f"Dispatcher: created {n} process job(s)")
    return n


async def queue_episodes_for_processing(episode_ids: list[str]) -> int:
    """
    Force-queue specific discovered episodes for processing right now. Used by
    admin actions (process/retry/retranscribe) that target particular episodes
    by explicit request — bypasses both the auto_download toggle and the
    scheduler's paused state, since those gates are meant to control automatic
    dispatch, not an explicit per-episode admin action. Returns the number of
    jobs actually created (an episode already mid-flight is skipped).
    """
    if not episode_ids:
        return 0
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT e.id::text AS episode_id, e.video_id, s.site, s.url AS source_url
        FROM episodes e
        JOIN sources s ON s.id = e.source_id
        WHERE e.id = ANY($1::uuid[]) AND e.status = 'discovered' AND e.blacklisted = FALSE AND e.title != ''
          AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.kind = 'process' AND j.status IN ('pending', 'claimed')
                AND j.episode_id = e.id
          )
        """,
        episode_ids,
    )
    n = await _enqueue_process_jobs(rows)
    if n:
        logger.info(f"Force-queued {n} process job(s) via admin action")
    return n


async def backfill_patreon_durations() -> int:
    """
    One-off admin action: queue a duration-probe job for every Patreon episode
    missing duration_seconds (episodes discovered before duration capture
    existed). Reuses the 'process' job kind with duration_only=True so blurb
    does a metadata-only yt-dlp probe — no re-download, no re-transcribe —
    and existing episodes are left untouched aside from that one column.
    Safe to call repeatedly; already-queued/duration-known episodes are
    skipped. Returns the number of jobs created.
    """
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT e.id::text AS episode_id, e.video_id
        FROM episodes e
        JOIN sources s ON s.id = e.source_id
        WHERE s.site = 'patreon' AND e.duration_seconds IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.kind = 'process' AND j.status IN ('pending', 'claimed')
                AND j.episode_id = e.id
          )
        """
    )
    created = 0
    for row in rows:
        try:
            await _create_job(
                "process",
                {
                    "episode_id": row["episode_id"],
                    "site": "patreon",
                    "video_id": row["video_id"],
                    "duration_only": True,
                },
                episode_id=row["episode_id"],
            )
            created += 1
        except asyncpg.exceptions.UniqueViolationError:
            continue
    if created:
        logger.info(f"Queued {created} Patreon duration-probe job(s)")
    return created


async def dispatch_worker() -> None:
    """Background loop: sweeps for discovered episodes on wakeup or on a fixed interval."""
    while True:
        try:
            _dispatch_wakeup.clear()

            if not _processing_paused:
                await sync_process_jobs()

            try:
                await asyncio.wait_for(_dispatch_wakeup.wait(), timeout=_SWEEP_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Dispatch worker unhandled error: {exc}")
            await asyncio.sleep(5)


def start_dispatch_worker() -> None:
    global _dispatch_task
    _dispatch_task = asyncio.create_task(dispatch_worker(), name="dispatch-worker")
    logger.info("Dispatch worker started")


def stop_dispatch_worker() -> None:
    global _dispatch_task
    if _dispatch_task:
        _dispatch_task.cancel()
        _dispatch_task = None
    logger.info("Dispatch worker stopped")


def get_dispatch_status() -> dict:
    """Status of conductor's own dispatch loop — NOT the remote blurb worker
    (see worker_status.get_worker_status for that). Named distinctly so the
    two don't get confused when both end up in the same /admin/live payload."""
    active = 1 if _dispatch_task and not _dispatch_task.done() else 0
    return {"active": active, "capacity": 1}


# --------------------------------------------------------------------------- #
# Discovery — enqueue-only; blurb does the actual scraping                    #
# --------------------------------------------------------------------------- #

async def run_discovery(
    podcast_id: str | None = None,
    auto_queue: bool = True,
    source_id: str | None = None,
    dry_run: bool = False,
) -> dict:
    """
    Enqueue a 'discover' job for every enabled source (or one podcast's, or a
    single source). Discovery itself now runs on blurb, using its local
    YouTube/Patreon cookies (RSS sources need no local credential at all — any
    auth is embedded in the feed URL) — conductor never touches
    YouTube/Patreon credentials. This returns as soon as the jobs are queued;
    results land asynchronously via handle_discover_complete as blurb works
    through it.

    auto_queue=False tags the jobs so their results are written to the DB
    without auto-dispatching process jobs afterward — useful for reviewing
    a backlog before committing to processing it.

    dry_run=True asks the worker to scrape the source without applying the
    result (no inserts/blacklists/orphaning). The job result is then summarised
    for the admin console's source test view.
    """
    label = source_id or podcast_id or "all"

    sources_by_site: list[tuple[str, list]] = []
    if source_id:
        # Single-source rerun is a precision tool in the console (one feed is
        # broken; don't re-scrape the whole podcast). SourceRow doesn't carry
        # `site`, so read that one row directly.
        pool = db.get_pool()
        row = await pool.fetchrow(
            "SELECT id::text, site, url, podcast_id FROM sources "
            "WHERE id = $1::uuid AND enabled = TRUE",
            source_id,
        )
        if row:
            sources_by_site = [(row["site"], [row])]
    else:
        yt_sources = await get_enabled_sources_by_site("youtube", podcast_id=podcast_id)
        patreon_sources = await get_enabled_sources_by_site("patreon", podcast_id=podcast_id)
        rss_sources = await get_enabled_sources_by_site("rss", podcast_id=podcast_id)
        sources_by_site = [
            ("youtube", yt_sources),
            ("patreon", patreon_sources),
            ("rss", rss_sources),
        ]

    queued = 0
    job_ids: list[str] = []
    for site, sources in sources_by_site:
        for source in sources:
            try:
                job_id = await _create_job(
                    "discover",
                    {
                        "source_id": source["id"],
                        "site": site,
                        "url": source["url"],
                        "podcast_id": source["podcast_id"],
                        "auto_queue": auto_queue,
                        "dry_run": dry_run,
                    },
                    source_id=source["id"],
                )
                queued += 1
                job_ids.append(job_id)
            except asyncpg.exceptions.UniqueViolationError:
                logger.info("Source %s already has a discover job in flight, skipping", source["id"])

    logger.info(f"Discovery run queued (scope={label}, dry_run={dry_run}): {queued} discover job(s)")
    return {"sources": queued, "discover_jobs_queued": queued, "job_ids": job_ids}


# --------------------------------------------------------------------------- #
# Job completion handlers — called from the /worker/jobs/{id}/complete|fail   #
# endpoints once the DB row has been transitioned.                            #
# --------------------------------------------------------------------------- #

async def _summarize_dry_run(job_id: str, source, entries: list[dict]) -> None:
    """Turn a dry-run discovery result into a compact summary stored on the job."""
    pool = db.get_pool()
    title_exclude = [str(s).lower() for s in (source["filters"] or {}).get("title_exclude", [])]
    min_duration = await settings.get_int("min_episode_duration_seconds")

    title_excluded = 0
    unavailable = 0
    too_short = 0
    eligible: list[dict] = []
    seen_ids: list[str] = []

    for entry in entries:
        video_id = entry.get("video_id")
        title = entry.get("title") or ""
        if not video_id:
            continue
        seen_ids.append(video_id)
        if not title or (title.startswith("[") and title.endswith("]")):
            unavailable += 1
            continue
        if any(excl in title.lower() for excl in title_exclude):
            title_excluded += 1
            continue
        duration = entry.get("duration")
        if min_duration and duration is not None and duration < min_duration:
            too_short += 1
            continue
        eligible.append(entry)

    known_rows = await pool.fetch(
        "SELECT video_id FROM episodes WHERE source_id = $1::uuid",
        source["id"],
    )
    known = {r["video_id"] for r in known_rows}
    seen = set(seen_ids)
    summary = {
        "dry_run": True,
        "entry_count": len(seen_ids),
        "would_import": len([e for e in eligible if e.get("video_id") not in known]),
        "already_known": len([e for e in eligible if e.get("video_id") in known]),
        "title_excluded": title_excluded,
        "unavailable": unavailable,
        "too_short": too_short,
        "would_orphan": len(known - seen),
        "title_exclude": title_exclude,
        "min_duration_seconds": min_duration,
        "sample": [
            {
                "video_id": e.get("video_id"),
                "title": e.get("title") or "",
                "pub_date": e.get("pub_date") or e.get("publication_date"),
                "duration": e.get("duration"),
            }
            for e in eligible[:30]
        ],
    }
    await pool.execute(
        "UPDATE jobs SET result = $1::jsonb WHERE id = $2::uuid",
        json.dumps(summary), job_id,
    )
    logger.info(
        "Dry-run discovery %s: %d entries, %d would import, %d known, %d excluded, %d unavailable, %d too short",
        job_id, summary["entry_count"], summary["would_import"], summary["already_known"],
        title_excluded, unavailable, too_short,
    )


async def handle_discover_complete(job_id: str, payload: dict, result: dict) -> None:
    source_id = payload["source_id"]
    podcast_id = payload.get("podcast_id", "")
    entries = result.get("entries", [])
    icon = result.get("icon")

    source = await get_source(source_id)
    if not source:
        logger.warning(f"Discover job {job_id}: source {source_id} no longer exists, discarding result")
        return

    if payload.get("dry_run"):
        await _summarize_dry_run(job_id, source, entries)
        return

    new_episodes, reactivated_count = await apply_discovery_results(source_id, source["filters"], entries)

    if icon and icon.get("bytes_b64"):
        try:
            image_bytes = base64.b64decode(icon["bytes_b64"])
            await apply_channel_icon(
                podcast_id, icon.get("url", ""), icon.get("content_type", "image/jpeg"), image_bytes
            )
        except Exception as exc:
            logger.warning(f"Discover job {job_id}: failed to apply channel icon: {exc}")

    if payload.get("auto_queue", True) and (new_episodes or reactivated_count):
        wakeup_worker()


async def handle_discover_fail(job_id: str, payload: dict, error: str) -> None:
    logger.error(f"Discover job {job_id} failed for source {payload.get('source_id')}: {error}")


async def handle_process_complete(job_id: str, payload: dict, result: dict) -> None:
    episode_id = payload["episode_id"]
    pool = db.get_pool()

    # Lightweight duration-only backfill job (see backfill_patreon_durations) —
    # just record the probed duration, don't touch transcript/status.
    if payload.get("duration_only"):
        duration_seconds = result.get("duration_seconds")
        if duration_seconds is not None:
            await pool.execute(
                "UPDATE episodes SET duration_seconds = $1 WHERE id = $2::uuid",
                duration_seconds, episode_id,
            )
            caches.bust_episodes_cache()
        else:
            logger.warning(f"Job {job_id}: duration probe for episode {episode_id} returned no duration")
        return

    transcript = result.get("transcript")
    publication_date = result.get("publication_date")
    duration_seconds = result.get("duration_seconds")

    if publication_date:
        try:
            pub_date = datetime.strptime(publication_date, "%Y-%m-%d").date()
            await pool.execute(
                "UPDATE episodes SET publication_date = COALESCE(publication_date, $1) WHERE id = $2::uuid",
                pub_date, episode_id,
            )
        except Exception as exc:
            logger.warning(f"Job {job_id}: failed to set publication_date {publication_date!r} for {episode_id}: {exc}")

    if duration_seconds is not None:
        await pool.execute(
            "UPDATE episodes SET duration_seconds = COALESCE(duration_seconds, $1) WHERE id = $2::uuid",
            duration_seconds, episode_id,
        )

    try:
        target_words = await settings.get_int("chunk_target_words") or 50
        await process_transcript(episode_id, transcript, target_words=target_words)
        await pool.execute("UPDATE episodes SET status='processed' WHERE id=$1::uuid", episode_id)
        logger.info(f"Episode {episode_id} fully processed")
    except Exception as exc:
        logger.error(f"process_transcript failed for {episode_id}: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid", str(exc), episode_id,
        )

    caches.bust_episodes_cache()
    await _check_consecutive_failure(episode_id)


# Maps the error_type blurb reports on a failed process job to what happens
# to the episode. 'rate_limited' goes back to 'discovered' — transient, the
# dispatcher's periodic sweep will retry it without a tight retry loop.
_PROCESS_ERROR_OUTCOME = {
    "unavailable": "failed",
    "age_restricted": "failed",
    "too_short": "blacklisted",
    "rate_limited": "discovered",
    "other": "failed",
}


async def handle_process_fail(job_id: str, payload: dict, error: str, error_type: str | None) -> None:
    episode_id = payload["episode_id"]

    # Duration-only backfill jobs target episodes that are already processed —
    # a failed probe (post removed, transient network error) must not flip
    # their status. Just log it; the episode is picked up again by the next
    # backfill sweep since duration_seconds is still NULL.
    if payload.get("duration_only"):
        logger.warning(f"Duration probe job {job_id} failed for episode {episode_id}: {error}")
        return

    pool = db.get_pool()
    outcome = _PROCESS_ERROR_OUTCOME.get(error_type or "other", "failed")

    if outcome == "blacklisted":
        logger.info(f"Episode {episode_id} blacklisted: {error}")
        await pool.execute(
            "UPDATE episodes SET status='blacklisted', blacklisted=TRUE, error_message=$1 WHERE id=$2::uuid",
            error, episode_id,
        )
    elif outcome == "discovered":
        logger.warning(f"Episode {episode_id} rate limited, will retry: {error}")
        await pool.execute(
            "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id,
        )
    else:
        logger.error(f"Episode {episode_id} failed ({error_type}): {error}")
        await pool.execute(
            "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid", error, episode_id,
        )
        await _check_consecutive_failure(episode_id)

    caches.bust_episodes_cache()


# --------------------------------------------------------------------------- #
# Startup / reclaim                                                           #
# --------------------------------------------------------------------------- #

async def recover_interrupted_downloads() -> None:
    """
    On startup, reset any episode stuck in 'downloading' that has no live
    process job back to 'discovered'.

    Unlike the old design (where conductor downloaded audio and blurb fetched
    it over HTTP), blurb now downloads and holds audio locally — an in-flight
    claimed job safely survives a conductor restart and will post its result
    back whenever conductor comes back up. Nothing needs to be cancelled here.
    """
    pool = db.get_pool()
    result = await pool.execute(
        """
        UPDATE episodes
        SET status = 'discovered', error_message = 'Reset: no active process job found'
        WHERE status = 'downloading' AND blacklisted = FALSE
          AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.kind = 'process' AND j.status IN ('pending', 'claimed')
                AND j.episode_id = episodes.id
          )
        """
    )
    n = int(result.split()[-1])
    if n:
        logger.warning("Startup recovery: %d episode(s) stuck in 'downloading' reset to discovered", n)
        caches.bust_episodes_cache()
    else:
        logger.info("Startup recovery: no orphaned in-flight episodes found")


async def reclaim_stuck_jobs() -> None:
    """
    Reset jobs stuck in 'claimed' for more than 2 hours back to 'pending' (a
    blurb worker likely died mid-job without reporting back), then reset any
    'downloading' episode left with no live job. Runs every 30 minutes.
    """
    pool = db.get_pool()
    result = await pool.execute(
        """
        UPDATE jobs SET status = 'pending', claimed_at = NULL, claimed_by_worker = NULL
        WHERE status = 'claimed' AND claimed_at < now() - interval '2 hours'
        """
    )
    n = int(result.split()[-1])
    if n:
        logger.warning(f"Reclaimed {n} stuck job(s) back to pending")
    else:
        logger.info("No stuck jobs found")

    await recover_interrupted_downloads()
    await _record_job_run("last_reclaim_run")


# --------------------------------------------------------------------------- #
# Scheduler                                                                    #
# --------------------------------------------------------------------------- #

async def _persist_processing_paused(paused: bool) -> None:
    pool = db.get_pool()
    await pool.execute(
        """INSERT INTO settings (key, value) VALUES ('processing_paused', $1)
           ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()""",
        "true" if paused else "false",
    )


async def _record_job_run(key: str) -> None:
    pool = db.get_pool()
    await pool.execute(
        """INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()""",
        key, datetime.now(timezone.utc).isoformat(),
    )


async def scheduled_discovery() -> None:
    """Scheduled wrapper — skipped when auto_discover is off."""
    if not await settings.get("auto_discover"):
        logger.info("Scheduled discovery skipped (auto_discover=false)")
        return
    await run_discovery(auto_queue=True)
    await _record_job_run("last_discovery_run")


async def purge_job_history() -> int:
    """Delete finished jobs older than the configured retention window."""
    days = await settings.get_int("job_history_retention_days", default=0)
    if days <= 0:
        return 0
    pool = db.get_pool()
    result = await pool.execute(
        """
        DELETE FROM jobs
        WHERE status IN ('completed', 'failed')
          AND COALESCE(finished_at, created_at) < now() - ($1::int * interval '1 day')
        """,
        days,
    )
    deleted = int(result.split()[-1])
    if deleted:
        logger.info("Retention: purged %d job(s) older than %d days", deleted, days)
        await _record_job_run("last_history_purge")
    return deleted


def _discovery_trigger(cron: str) -> CronTrigger:
    return CronTrigger.from_crontab(cron, timezone=_SCHEDULER_TIMEZONE)


async def reschedule_discovery(cron: str | None) -> str:
    """Apply a cron expression to the live discovery job.

    Returns the expression actually applied (falls back to the default if the
    stored value is invalid).
    """
    expression = (cron or "").strip() or DEFAULT_DISCOVERY_CRON
    try:
        trigger = _discovery_trigger(expression)
    except Exception as exc:
        logger.warning("Invalid discovery schedule %r (%s); using default", expression, exc)
        expression = DEFAULT_DISCOVERY_CRON
        trigger = _discovery_trigger(expression)

    if _scheduler.get_job("discovery"):
        _scheduler.reschedule_job("discovery", trigger=trigger)
    else:
        _scheduler.add_job(scheduled_discovery, trigger=trigger, id="discovery")
    logger.info("Discovery schedule set to %s (%s)", expression, _SCHEDULER_TIMEZONE)
    return expression


async def start_scheduler() -> None:
    global _processing_paused
    pool = db.get_pool()
    rows = await pool.fetch(
        "SELECT key, value FROM settings WHERE key IN "
        "('processing_paused', 'last_discovery_run', 'last_reclaim_run', 'discovery_schedule')"
    )
    state = {row["key"]: row["value"] for row in rows}

    _processing_paused = state.get("processing_paused", "false").lower() == "true"
    now = datetime.now(timezone.utc)

    def _next_run(last_key: str, **delta_kwargs) -> datetime:
        last_str = state.get(last_key)
        if last_str:
            try:
                last = datetime.fromisoformat(last_str)
                candidate = last + timedelta(**delta_kwargs)
                if candidate > now:
                    return candidate
            except ValueError:
                pass
        return now + timedelta(**delta_kwargs)

    await reschedule_discovery(state.get("discovery_schedule"))
    _scheduler.add_job(
        reclaim_stuck_jobs, "interval", minutes=30, id="reclaim",
        next_run_time=_next_run("last_reclaim_run", minutes=30),
    )
    _scheduler.add_job(
        purge_job_history, "interval", hours=6, id="history-purge",
    )
    _scheduler.add_job(
        analytics.purge_old_analytics, "interval", hours=24, id="analytics-purge",
        next_run_time=now + timedelta(minutes=10),
    )
    # The scheduler itself always runs — the discovery cron (gated by its own
    # auto_discover check) and the reclaim sweep are unrelated to whether
    # processing is paused, and should never stop as a side effect of it.
    _scheduler.start()
    logger.info(
        "Scheduler started (discovery=%s, reclaim every 30min); processing %s",
        state.get("discovery_schedule") or DEFAULT_DISCOVERY_CRON,
        "paused" if _processing_paused else "running",
    )


def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)


def is_processing_paused() -> bool:
    """Whether a 'process' job can currently be claimed — checked by
    /worker/jobs/next. Does not affect 'discover' jobs or the scheduler."""
    return _processing_paused


def get_scheduler_status() -> dict:
    """Return processing-paused state, scheduled-job next-run times, and
    conductor's own dispatch-loop status (distinct from the remote blurb
    worker's status)."""
    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return {
        "running": _scheduler.running,
        "processing_paused": _processing_paused,
        "consecutive_failures": _consecutive_failures,
        "jobs": jobs,
        "dispatch": get_dispatch_status(),
    }


async def pause_processing() -> None:
    """Stop 'process' jobs from being claimed. Does not touch the scheduler —
    discovery and reclaim keep running; manual discovery keeps working too."""
    global _processing_paused
    _processing_paused = True
    await _persist_processing_paused(True)
    logger.info("Processing paused via admin")


async def resume_processing() -> None:
    global _consecutive_failures, _processing_paused
    _consecutive_failures = 0
    _processing_paused = False
    await _persist_processing_paused(False)
    wakeup_worker()
    logger.info("Processing resumed via admin")
