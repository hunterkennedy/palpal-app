import asyncio
import base64
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

import db
import pipeline_settings as settings
from activities.discovery import (
    get_enabled_youtube_sources, get_enabled_patreon_sources, get_source,
    apply_discovery_results, apply_channel_icon,
)
from activities.process import process_transcript

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()
_dispatch_wakeup = asyncio.Event()
_dispatch_task: asyncio.Task | None = None
_consecutive_failures = 0

# How often the dispatcher re-sweeps for discovered episodes even without an
# explicit wakeup — catches episodes reset by a rate-limit/backoff failure.
_SWEEP_INTERVAL_SECONDS = 300.0


def wakeup_worker() -> None:
    """Signal the dispatcher to sweep for discovered episodes needing a process job."""
    _dispatch_wakeup.set()


async def _check_consecutive_failure(episode_id: str) -> None:
    """Increment the failure counter and auto-pause the scheduler if threshold is hit."""
    global _consecutive_failures
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT status FROM episodes WHERE id = $1::uuid", episode_id)
    if row and row["status"] == "failed":
        _consecutive_failures += 1
        if _consecutive_failures >= 5:
            logger.warning("Auto-pausing scheduler after %d consecutive failures", _consecutive_failures)
            await _persist_scheduler_paused(True)
            _scheduler.pause()
            _consecutive_failures = 0
    else:
        _consecutive_failures = 0


# --------------------------------------------------------------------------- #
# Job creation                                                                 #
# --------------------------------------------------------------------------- #

async def _create_job(kind: str, payload: dict) -> str:
    pool = db.get_pool()
    # payload goes through asyncpg's jsonb codec (db.py registers json.dumps/loads),
    # which encodes dicts automatically — dumping it here double-encodes it into a
    # jsonb string scalar instead of an object.
    row = await pool.fetchrow(
        "INSERT INTO jobs (kind, payload) VALUES ($1, $2::jsonb) RETURNING id::text",
        kind, payload,
    )
    return row["id"]


async def cancel_process_job(episode_id: str, reason: str) -> None:
    """Cancel any pending/claimed process job for an episode (admin retry/retranscribe/delete)."""
    pool = db.get_pool()
    await pool.execute(
        """
        UPDATE jobs SET status='failed', error=$1
        WHERE kind='process' AND status IN ('pending','claimed')
          AND payload->>'episode_id' = $2
        """,
        reason, episode_id,
    )


async def sync_process_jobs() -> int:
    """
    Create a 'process' job for every 'discovered' episode that doesn't already
    have one pending/claimed. Idempotent — safe to call after discovery
    completes, after an admin action, or from the periodic sweep. Returns the
    number of jobs created.
    """
    if not await settings.get("auto_download"):
        return 0

    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT e.id::text AS episode_id, e.video_id, s.site
        FROM episodes e
        JOIN sources s ON s.id = e.source_id
        JOIN podcasts p ON s.podcast_id = p.id
        WHERE e.status = 'discovered' AND e.blacklisted = FALSE
          AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.kind = 'process' AND j.status IN ('pending', 'claimed')
                AND j.payload->>'episode_id' = e.id::text
          )
        ORDER BY p.display_order ASC, e.created_at DESC
        """
    )
    if not rows:
        return 0

    min_duration = await settings.get_int("min_episode_duration_seconds")
    for row in rows:
        await _create_job("process", {
            "episode_id": row["episode_id"],
            "site": row["site"],
            "video_id": row["video_id"],
            "min_duration_seconds": min_duration,
        })
        await pool.execute(
            "UPDATE episodes SET status='downloading' WHERE id=$1::uuid", row["episode_id"]
        )

    logger.info(f"Dispatcher: created {len(rows)} process job(s)")
    return len(rows)


async def dispatch_worker() -> None:
    """Background loop: sweeps for discovered episodes on wakeup or on a fixed interval."""
    while True:
        try:
            _dispatch_wakeup.clear()

            from apscheduler.schedulers.base import STATE_PAUSED
            if _scheduler.state != STATE_PAUSED:
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


def get_worker_status() -> dict:
    active = 1 if _dispatch_task and not _dispatch_task.done() else 0
    return {"active": active, "capacity": 1}


# --------------------------------------------------------------------------- #
# Discovery — enqueue-only; blurb does the actual scraping                    #
# --------------------------------------------------------------------------- #

async def run_discovery(podcast_id: str | None = None, auto_queue: bool = True) -> dict:
    """
    Enqueue a 'discover' job for every enabled source (or one podcast's).
    Discovery itself now runs on blurb, using its local YouTube/Patreon
    cookies — conductor never touches those credentials. This returns as
    soon as the jobs are queued; results land asynchronously via
    handle_discover_complete as blurb works through them.

    auto_queue=False tags the jobs so their results are written to the DB
    without auto-dispatching process jobs afterward — useful for reviewing
    a backlog before committing to processing it.
    """
    label = podcast_id or "all"
    yt_sources = await get_enabled_youtube_sources(podcast_id=podcast_id)
    patreon_sources = await get_enabled_patreon_sources(podcast_id=podcast_id)

    queued = 0
    for site, sources in (("youtube", yt_sources), ("patreon", patreon_sources)):
        for source in sources:
            await _create_job("discover", {
                "source_id": source["id"],
                "site": site,
                "url": source["url"],
                "podcast_id": source["podcast_id"],
                "auto_queue": auto_queue,
            })
            queued += 1

    logger.info(f"Discovery run queued (podcast={label}): {queued} discover job(s)")
    return {"sources": queued, "discover_jobs_queued": queued}


# --------------------------------------------------------------------------- #
# Job completion handlers — called from the /worker/jobs/{id}/complete|fail   #
# endpoints once the DB row has been transitioned.                            #
# --------------------------------------------------------------------------- #

async def handle_discover_complete(job_id: str, payload: dict, result: dict) -> None:
    source_id = payload["source_id"]
    podcast_id = payload.get("podcast_id", "")
    entries = result.get("entries", [])
    icon = result.get("icon")

    source = await get_source(source_id)
    if not source:
        logger.warning(f"Discover job {job_id}: source {source_id} no longer exists, discarding result")
        return

    new_episodes = await apply_discovery_results(source_id, source["filters"], entries)

    if icon and icon.get("bytes_b64"):
        try:
            image_bytes = base64.b64decode(icon["bytes_b64"])
            await apply_channel_icon(
                podcast_id, icon.get("url", ""), icon.get("content_type", "image/jpeg"), image_bytes
            )
        except Exception as exc:
            logger.warning(f"Discover job {job_id}: failed to apply channel icon: {exc}")

    if payload.get("auto_queue", True) and new_episodes:
        wakeup_worker()


async def handle_discover_fail(job_id: str, payload: dict, error: str) -> None:
    logger.error(f"Discover job {job_id} failed for source {payload.get('source_id')}: {error}")


async def handle_process_complete(job_id: str, payload: dict, result: dict) -> None:
    episode_id = payload["episode_id"]
    pool = db.get_pool()
    transcript = result.get("transcript")
    publication_date = result.get("publication_date")

    if publication_date:
        await pool.execute(
            "UPDATE episodes SET publication_date = COALESCE(publication_date, $1::date) WHERE id = $2::uuid",
            publication_date, episode_id,
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
                AND j.payload->>'episode_id' = episodes.id::text
          )
        """
    )
    n = int(result.split()[-1])
    if n:
        logger.warning("Startup recovery: %d episode(s) stuck in 'downloading' reset to discovered", n)
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

async def _persist_scheduler_paused(paused: bool) -> None:
    pool = db.get_pool()
    await pool.execute(
        """INSERT INTO settings (key, value) VALUES ('scheduler_paused', $1)
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


async def start_scheduler() -> None:
    pool = db.get_pool()
    rows = await pool.fetch(
        "SELECT key, value FROM settings WHERE key IN ('scheduler_paused', 'last_discovery_run', 'last_reclaim_run')"
    )
    state = {row["key"]: row["value"] for row in rows}

    was_paused = state.get("scheduler_paused", "false").lower() == "true"
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

    _scheduler.add_job(
        scheduled_discovery, "cron", hour="0,6,12,18", minute=0, id="discovery", timezone="America/Los_Angeles",
    )
    _scheduler.add_job(
        reclaim_stuck_jobs, "interval", minutes=30, id="reclaim",
        next_run_time=_next_run("last_reclaim_run", minutes=30),
    )
    _scheduler.start()

    if was_paused:
        _scheduler.pause()
        logger.info("Scheduler started in paused state (restored from DB)")
    else:
        logger.info("Scheduler started (discovery every 6h, reclaim every 30min)")


def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)


def get_scheduler_status() -> dict:
    """Return scheduler running/paused state, job next-run times, and worker status."""
    from apscheduler.schedulers.base import STATE_PAUSED
    paused = _scheduler.state == STATE_PAUSED
    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return {
        "running": _scheduler.running,
        "paused": paused,
        "jobs": jobs,
        "worker": get_worker_status(),
    }


async def pause_scheduler() -> None:
    await _persist_scheduler_paused(True)
    _scheduler.pause()
    logger.info("Scheduler paused via admin")


async def resume_scheduler() -> None:
    global _consecutive_failures
    _consecutive_failures = 0
    await _persist_scheduler_paused(False)
    _scheduler.resume()
    wakeup_worker()
    logger.info("Scheduler resumed via admin")
