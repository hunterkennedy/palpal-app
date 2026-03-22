import asyncio
import glob as glob_module
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

import db
import pipeline_settings as settings
from activities.discovery import (
    get_enabled_youtube_sources, discover_youtube_source,
    get_enabled_patreon_sources, discover_patreon_source,
)
from activities.download import download_audio, EpisodeTooShortError, EpisodeUnavailableError, EpisodeRateLimitedError
from activities.blurb import enqueue_transcription
from activities.process import process_transcript

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()
_download_wakeup = asyncio.Event()
_transcribe_wakeup = asyncio.Event()
_worker_tasks: list[asyncio.Task] = []
_consecutive_failures = 0

# Maps transcription job_id → Event; set when the worker posts a result or failure.
_job_events: dict[str, asyncio.Event] = {}

# Number of pre-downloaded episodes to keep ready while transcription runs.
_DOWNLOAD_BUFFER = 1


def signal_job_complete(job_id: str) -> None:
    """Wake a pipeline coroutine waiting on a specific transcription job."""
    event = _job_events.get(job_id)
    if event:
        event.set()


async def _check_consecutive_failure(episode_id: str) -> None:
    """Increment the failure counter and auto-pause the scheduler if threshold is hit."""
    global _consecutive_failures
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status FROM episodes WHERE id = $1::uuid", episode_id
    )
    if row and row["status"] == "failed":
        _consecutive_failures += 1
        if _consecutive_failures >= 5:
            logger.warning("Auto-pausing scheduler after %d consecutive failures", _consecutive_failures)
            await _persist_scheduler_paused(True)
            _scheduler.pause()
            _consecutive_failures = 0
    else:
        _consecutive_failures = 0


async def download_worker() -> None:
    """
    Pre-fetch worker. Claims one 'discovered' episode at a time, downloads the
    audio, inserts a 'queued' transcription job (invisible to blurb workers), and
    marks the episode 'downloaded'. Immediately loops to stay up to _DOWNLOAD_BUFFER
    episodes ahead of the transcribe worker.
    """
    pool = db.get_pool()
    while True:
        try:
            _download_wakeup.clear()

            from apscheduler.schedulers.base import STATE_PAUSED
            if not await settings.get("auto_download") or _scheduler.state == STATE_PAUSED:
                try:
                    await asyncio.wait_for(_download_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            # Don't get too far ahead — wait if the buffer is already full.
            buffer_count = await pool.fetchval(
                "SELECT COUNT(*) FROM episodes WHERE status = 'downloaded'"
            )
            if buffer_count >= _DOWNLOAD_BUFFER:
                try:
                    await asyncio.wait_for(_download_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            row = await pool.fetchrow(
                """
                UPDATE episodes SET status = 'downloading'
                WHERE id = (
                    SELECT e.id FROM episodes e
                    JOIN sources s ON e.source_id = s.id
                    JOIN podcasts p ON s.podcast_id = p.id
                    WHERE e.status = 'discovered' AND e.blacklisted = FALSE
                    ORDER BY p.display_order ASC, e.created_at DESC
                    LIMIT 1
                    FOR UPDATE OF e SKIP LOCKED
                )
                RETURNING id::text
                """
            )

            if not row:
                try:
                    await asyncio.wait_for(_download_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            episode_id = row["id"]

            try:
                audio_path = await download_audio(episode_id)

            except EpisodeUnavailableError as exc:
                logger.info(f"Episode {episode_id} unavailable: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )
                await _check_consecutive_failure(episode_id)
                continue

            except EpisodeRateLimitedError as exc:
                logger.warning(f"Episode {episode_id} rate limited, backing off 60s: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
                    episode_id,
                )
                await asyncio.sleep(60)
                continue

            except EpisodeTooShortError as exc:
                logger.info(f"Episode {episode_id} too short, blacklisting: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', blacklisted=TRUE, error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )
                continue

            except Exception as exc:
                logger.error(f"Episode {episode_id} download failed: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )
                await _check_consecutive_failure(episode_id)
                continue

            # Insert as 'queued' — blurb workers only claim 'pending' jobs.
            await pool.execute(
                """
                INSERT INTO transcription_jobs (episode_id, audio_path, status)
                VALUES ($1::uuid, $2, 'queued')
                """,
                episode_id, audio_path,
            )
            await pool.execute(
                "UPDATE episodes SET status='downloaded' WHERE id=$1::uuid", episode_id
            )
            logger.info(f"Episode {episode_id} downloaded and queued for transcription")
            _transcribe_wakeup.set()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Download worker unhandled error: {exc}")
            await asyncio.sleep(5)


async def transcribe_worker() -> None:
    """
    Serial transcription worker. Claims one 'downloaded' episode at a time,
    promotes its transcription job from 'queued' to 'pending' (making it
    claimable by blurb), waits for the result, then processes the transcript.
    Only one episode is ever in-flight with blurb at a time.

    After claiming a job it immediately wakes the download worker so it can
    pre-fetch the next episode while blurb is running.
    """
    pool = db.get_pool()
    while True:
        try:
            _transcribe_wakeup.clear()

            from apscheduler.schedulers.base import STATE_PAUSED
            if not await settings.get("auto_transcribe") or _scheduler.state == STATE_PAUSED:
                try:
                    await asyncio.wait_for(_transcribe_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            # Claim next downloaded episode: promote its job from queued → pending.
            row = await pool.fetchrow(
                """
                UPDATE transcription_jobs SET status = 'pending'
                WHERE id = (
                    SELECT tj.id FROM transcription_jobs tj
                    JOIN episodes e ON tj.episode_id = e.id
                    JOIN sources s ON e.source_id = s.id
                    JOIN podcasts p ON s.podcast_id = p.id
                    WHERE e.status = 'downloaded' AND tj.status = 'queued'
                    ORDER BY p.display_order ASC, e.created_at DESC
                    LIMIT 1
                    FOR UPDATE OF tj SKIP LOCKED
                )
                RETURNING id::text, episode_id::text, audio_path
                """
            )

            if not row:
                try:
                    await asyncio.wait_for(_transcribe_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            job_id = row["id"]
            episode_id = row["episode_id"]
            audio_path = row["audio_path"]

            await pool.execute(
                "UPDATE episodes SET status='transcribing' WHERE id=$1::uuid", episode_id
            )

            # Wake the download worker — it can now pre-fetch the next episode.
            _download_wakeup.set()

            # ── Wait for transcription result ──────────────────────────────────
            event = asyncio.Event()
            _job_events[job_id] = event
            try:
                while True:
                    try:
                        await asyncio.wait_for(asyncio.shield(event.wait()), timeout=30.0)
                        break
                    except asyncio.TimeoutError:
                        result_row = await pool.fetchrow(
                            "SELECT status FROM transcription_jobs WHERE id=$1::uuid", job_id
                        )
                        if result_row and result_row["status"] in ("completed", "failed"):
                            break

                result_row = await pool.fetchrow(
                    "SELECT status, result, error FROM transcription_jobs WHERE id=$1::uuid", job_id
                )
                if not result_row or result_row["status"] != "completed":
                    error = (result_row["error"] if result_row else None) or "transcription job missing or failed"
                    raise Exception(error)

                transcript = result_row["result"]
                if isinstance(transcript, str):
                    transcript = json.loads(transcript)

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(f"Transcription failed for episode {episode_id}: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )
                await _check_consecutive_failure(episode_id)
                continue
            finally:
                _job_events.pop(job_id, None)
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass

            # ── Process transcript ─────────────────────────────────────────────
            try:
                target_words = await settings.get_int("chunk_target_words") or 50
                await process_transcript(episode_id, transcript, target_words=target_words)
                await pool.execute(
                    "UPDATE episodes SET status='processed' WHERE id=$1::uuid", episode_id
                )
                logger.info(f"Episode {episode_id} fully processed")
            except Exception as exc:
                logger.error(f"process_transcript failed for {episode_id}: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )

            await _check_consecutive_failure(episode_id)

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Transcribe worker unhandled error: {exc}")
            await asyncio.sleep(5)


def wakeup_worker() -> None:
    """Signal the download worker to check the queue immediately."""
    _download_wakeup.set()


def start_download_worker() -> None:
    dl = asyncio.create_task(download_worker(), name="download-worker")
    tr = asyncio.create_task(transcribe_worker(), name="transcribe-worker")
    _worker_tasks.extend([dl, tr])
    logger.info("Download + transcribe workers started")


def stop_download_worker() -> None:
    for task in _worker_tasks:
        task.cancel()
    _worker_tasks.clear()
    logger.info("Workers stopped")


def get_worker_status() -> dict:
    active = sum(1 for t in _worker_tasks if not t.done())
    return {"active": active, "capacity": len(_worker_tasks)}


async def run_discovery(
    podcast_id: str | None = None,
    auto_queue: bool = True,
) -> dict:
    """
    Run discovery for all sources (or one podcast).

    Returns a summary dict: {sources, new_episodes, queued}.
    auto_queue=False discovers without waking the download worker — useful for
    manual testing where you want to pick specific episodes to process.
    """
    label = podcast_id or "all"
    logger.info(f"Discovery run starting (podcast={label}, auto_queue={auto_queue})")

    yt_sources = await get_enabled_youtube_sources(podcast_id=podcast_id)
    patreon_sources = await get_enabled_patreon_sources(podcast_id=podcast_id)

    total_new: list[str] = []

    for source in yt_sources:
        try:
            new_episodes = await discover_youtube_source(
                source["id"], source["url"], source["filters"],
                podcast_id=source["podcast_id"],
            )
            for ep in new_episodes:
                total_new.append(ep["episode_id"])
        except Exception as exc:
            logger.error(f"Discovery failed for YouTube source {source['id']}: {exc}")

    for source in patreon_sources:
        try:
            new_episodes = await discover_patreon_source(
                source["id"], source["url"], source["filters"],
                podcast_id=source["podcast_id"],
            )
            for ep in new_episodes:
                total_new.append(ep["episode_id"])
        except Exception as exc:
            logger.error(f"Discovery failed for Patreon source {source['id']}: {exc}")

    if auto_queue and total_new:
        wakeup_worker()

    total_sources = len(yt_sources) + len(patreon_sources)
    logger.info(f"Discovery run complete (podcast={label}): {len(total_new)} new, queued={auto_queue}")
    return {"sources": total_sources, "new_episodes": len(total_new), "queued": auto_queue}


async def recover_interrupted_downloads() -> None:
    """
    On startup, reset any in-flight episodes and clean up leftover state.

    Reset 'downloading', 'downloaded', and 'transcribing' episodes back to
    'discovered'. Cancel all queued/pending/claimed transcription jobs.
    Delete leftover audio files.
    """
    pool = db.get_pool()

    await pool.execute(
        "UPDATE transcription_jobs SET status='failed', error='Cancelled: conductor restarted' "
        "WHERE status IN ('queued', 'pending', 'claimed')"
    )

    r1 = await pool.execute(
        """
        UPDATE episodes
        SET status = 'discovered', error_message = 'Reset: interrupted by conductor restart'
        WHERE status IN ('downloading', 'downloaded', 'transcribing') AND blacklisted = FALSE
        """
    )
    n1 = int(r1.split()[-1])
    if n1:
        logger.warning("Startup recovery: %d in-flight episode(s) reset to discovered", n1)
    else:
        logger.info("Startup recovery: no interrupted episodes found")

    audio_dir = os.environ.get("AUDIO_PATH", "/tmp")
    leftovers = glob_module.glob(os.path.join(audio_dir, "*"))
    for f in leftovers:
        try:
            os.unlink(f)
        except OSError:
            pass
    if leftovers:
        logger.info("Startup cleanup: deleted %d leftover audio file(s)", len(leftovers))


async def reclaim_stuck_jobs() -> None:
    """
    Reset transcription_jobs stuck in 'claimed' for more than 2 hours back
    to 'pending'. Runs every 30 minutes.
    """
    pool = db.get_pool()
    result = await pool.execute(
        """
        UPDATE transcription_jobs
        SET status = 'pending', claimed_at = NULL
        WHERE status = 'claimed'
          AND claimed_at < now() - interval '2 hours'
        """
    )
    n = int(result.split()[-1])
    if n:
        logger.warning(f"Reclaimed {n} stuck transcription job(s) back to pending")
    else:
        logger.info("No stuck transcription jobs found")
    await _record_job_run("last_reclaim_run")


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
        scheduled_discovery, "interval", hours=24, id="discovery",
        next_run_time=_next_run("last_discovery_run", hours=24),
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
        logger.info("Scheduler started (discovery every 24h, reclaim every 30min)")


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
