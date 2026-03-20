import asyncio
import glob as glob_module
import logging
import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler

import db
import pipeline_settings as settings
from activities.discovery import (
    get_enabled_youtube_sources, discover_youtube_source,
    get_enabled_patreon_sources, discover_patreon_source,
)
from activities.download import download_audio, EpisodeTooShortError, EpisodeUnavailableError, EpisodeRateLimitedError
from activities.blurb import enqueue_transcription

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()
_wakeup = asyncio.Event()
_download_worker_tasks: list[asyncio.Task] = []


async def submit_downloaded_episode(episode_id: str, audio_path: str) -> None:
    """Enqueue a downloaded episode for transcription by a pull worker."""
    pool = db.get_pool()
    await pool.execute(
        "UPDATE episodes SET status='transcribing' WHERE id=$1::uuid", episode_id
    )
    try:
        await enqueue_transcription(episode_id, audio_path)
        logger.info(f"Episode {episode_id} queued for transcription")
    except Exception as exc:
        logger.error(f"Failed to enqueue {episode_id}: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
            str(exc), episode_id,
        )


async def download_worker() -> None:
    """
    Pull-based download worker. Runs continuously, claiming one episode at a time
    from the 'discovered' queue ordered by created_at DESC (newest first, so
    retried/old episodes naturally sit behind fresh discoveries).

    Multiple instances run in parallel for DOWNLOAD_CONCURRENCY > 1; each uses
    FOR UPDATE SKIP LOCKED to atomically claim a distinct episode.

    Sleeps when the queue is empty or auto_download is off, waking immediately
    when wakeup_worker() is called (e.g. after discovery or a manual trigger).
    """
    pool = db.get_pool()
    while True:
        try:
            _wakeup.clear()

            if not await settings.get("auto_download"):
                try:
                    await asyncio.wait_for(_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            row = await pool.fetchrow(
                """
                UPDATE episodes SET status = 'downloading'
                WHERE id = (
                    SELECT id FROM episodes
                    WHERE status = 'discovered' AND blacklisted = FALSE
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id::text
                """
            )

            if not row:
                try:
                    await asyncio.wait_for(_wakeup.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                continue

            episode_id = row["id"]
            try:
                audio_path = await download_audio(episode_id)
                await submit_downloaded_episode(episode_id, audio_path)

            except EpisodeUnavailableError as exc:
                logger.info(f"Episode {episode_id} is private/unavailable: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
                    episode_id,
                )

            except EpisodeRateLimitedError as exc:
                logger.warning(f"Episode {episode_id} rate limited, backing off 60s: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
                    episode_id,
                )
                await asyncio.sleep(60)

            except EpisodeTooShortError as exc:
                logger.info(f"Episode {episode_id} blacklisted at download: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', blacklisted=TRUE, error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )

            except Exception as exc:
                logger.error(f"Episode {episode_id} download failed: {exc}")
                await pool.execute(
                    "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
                    str(exc), episode_id,
                )

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Download worker unhandled error: {exc}")
            await asyncio.sleep(5)


def wakeup_worker() -> None:
    """Signal download worker(s) to check the queue immediately."""
    _wakeup.set()


def start_download_worker() -> None:
    n = int(os.environ.get("DOWNLOAD_CONCURRENCY", 1))
    for i in range(n):
        task = asyncio.create_task(download_worker(), name=f"download-worker-{i}")
        _download_worker_tasks.append(task)
    logger.info(f"Download worker started ({n} concurrent)")


def stop_download_worker() -> None:
    for task in _download_worker_tasks:
        task.cancel()
    _download_worker_tasks.clear()
    logger.info("Download worker stopped")


def get_worker_status() -> dict:
    n = int(os.environ.get("DOWNLOAD_CONCURRENCY", 1))
    active = sum(1 for t in _download_worker_tasks if not t.done())
    return {"active": active, "capacity": n}


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
    On startup, reset any episodes stuck in 'downloading' back to 'discovered'
    and sweep leftover audio files from a previous crash.

    Episodes in 'downloading' lost their worker context and must restart;
    the download worker will pick them up automatically.
    Episodes in 'transcribing' are NOT reset — their transcription_jobs rows are
    still valid and are reset to 'pending' so a pull worker can reclaim them.
    Audio files referenced by active jobs are preserved; all others are deleted.
    """
    pool = db.get_pool()

    # Preserve audio files that pending/claimed jobs still need
    active_rows = await pool.fetch(
        "SELECT audio_path FROM transcription_jobs WHERE status IN ('pending', 'claimed')"
    )
    active_paths = {row["audio_path"] for row in active_rows}

    audio_dir = os.environ.get("AUDIO_PATH", "/tmp")
    leftovers = glob_module.glob(os.path.join(audio_dir, "*"))
    deleted = 0
    for f in leftovers:
        if f not in active_paths:
            try:
                os.unlink(f)
                deleted += 1
                logger.info(f"Startup cleanup: deleted leftover audio file {f}")
            except OSError:
                pass
    if deleted:
        logger.warning(f"Startup cleanup: removed {deleted} leftover audio file(s)")
    if active_paths:
        logger.info(f"Startup cleanup: preserved {len(active_paths)} audio file(s) for pending jobs")

    r1 = await pool.execute(
        """
        UPDATE episodes
        SET status = 'discovered', error_message = 'Reset: download interrupted by conductor restart'
        WHERE status = 'downloading' AND blacklisted = FALSE
        """
    )
    # Release any claimed transcription jobs from a previous run.
    # transcribing episodes stay as-is — their jobs are now pending again.
    await pool.execute(
        "UPDATE transcription_jobs SET status='pending', claimed_at=NULL WHERE status='claimed'"
    )
    n1 = int(r1.split()[-1])
    if n1:
        logger.warning("Startup recovery: %d downloading→discovered", n1)
    else:
        logger.info("Startup recovery: no interrupted episodes found")


async def reclaim_stuck_jobs() -> None:
    """
    Reset transcription_jobs stuck in 'claimed' for more than 2 hours back
    to 'pending'. Runs every 30 minutes.

    A job gets stuck if the worker crashed before posting a result. 2 hours
    gives long episodes enough time to finish transcribing before being reclaimed.
    Resetting to pending makes the job available for the next worker poll.
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


async def scheduled_discovery() -> None:
    """Scheduled wrapper — skipped when auto_discover is off."""
    if not await settings.get("auto_discover"):
        logger.info("Scheduled discovery skipped (auto_discover=false)")
        return
    await run_discovery(auto_queue=True)


def start_scheduler() -> None:
    _scheduler.add_job(scheduled_discovery, "interval", hours=24, id="discovery")
    _scheduler.add_job(reclaim_stuck_jobs, "interval", minutes=30, id="reclaim")
    _scheduler.start()
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


def pause_scheduler() -> None:
    _scheduler.pause()
    logger.info("Scheduler paused via admin")


def resume_scheduler() -> None:
    _scheduler.resume()
    logger.info("Scheduler resumed via admin")
