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

_download_sem = asyncio.Semaphore(int(os.environ.get("DOWNLOAD_CONCURRENCY", 1)))
_scheduler = AsyncIOScheduler()


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


async def run_episode(episode_id: str) -> None:
    pool = db.get_pool()
    try:
        # Mark downloading immediately so it's visible in admin while waiting for the semaphore
        await pool.execute(
            "UPDATE episodes SET status='downloading' WHERE id=$1::uuid", episode_id
        )
        async with _download_sem:
            audio_path = await download_audio(episode_id)

        await submit_downloaded_episode(episode_id, audio_path)

    except EpisodeUnavailableError as exc:
        logger.info(f"Episode {episode_id} is private/unavailable, will retry on next discovery: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
            episode_id,
        )
    except EpisodeRateLimitedError as exc:
        logger.warning(f"Episode {episode_id} rate limited by YouTube, resetting to discovered: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
            episode_id,
        )
    except EpisodeTooShortError as exc:
        logger.info(f"Episode {episode_id} blacklisted at download: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='discovered', blacklisted=TRUE, error_message=$1 WHERE id=$2::uuid",
            str(exc), episode_id,
        )
    except Exception as exc:
        logger.error(f"Episode {episode_id} failed: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
            str(exc), episode_id,
        )


async def run_discovery(
    podcast_id: str | None = None,
    auto_queue: bool = True,
) -> dict:
    """
    Run discovery for all sources (or one podcast).

    Returns a summary dict: {sources, new_episodes, queued}.
    auto_queue=False discovers without starting the pipeline — useful for
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
                if auto_queue and await settings.get("auto_download"):
                    asyncio.create_task(run_episode(ep["episode_id"]))
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
                if auto_queue and await settings.get("auto_download"):
                    asyncio.create_task(run_episode(ep["episode_id"]))
        except Exception as exc:
            logger.error(f"Discovery failed for Patreon source {source['id']}: {exc}")

    total_sources = len(yt_sources) + len(patreon_sources)
    logger.info(f"Discovery run complete (podcast={label}): {len(total_new)} new, queued={auto_queue}")
    return {"sources": total_sources, "new_episodes": len(total_new), "queued": auto_queue}


async def recover_interrupted_downloads() -> None:
    """
    On startup, reset any episodes stuck mid-pipeline back to 'discovered'
    and sweep leftover audio files from a previous crash.

    Audio is ephemeral so there is nothing to resume from — any episode
    that was downloading or transcribing when the conductor died must start over.
    """
    audio_dir = os.environ.get("AUDIO_PATH", "/tmp")
    leftovers = glob_module.glob(os.path.join(audio_dir, "*"))
    for f in leftovers:
        try:
            os.unlink(f)
            logger.info(f"Startup cleanup: deleted leftover audio file {f}")
        except OSError:
            pass
    if leftovers:
        logger.warning(f"Startup cleanup: removed {len(leftovers)} leftover audio file(s)")

    pool = db.get_pool()
    r1 = await pool.execute(
        """
        UPDATE episodes
        SET status = 'discovered', error_message = 'Reset: download interrupted by conductor restart'
        WHERE status = 'downloading' AND blacklisted = FALSE
        """
    )
    r2 = await pool.execute(
        """
        UPDATE episodes
        SET status = 'discovered', error_message = 'Reset: transcription interrupted by conductor restart'
        WHERE status = 'transcribing' AND blacklisted = FALSE
        """
    )
    # Release any claimed jobs from a previous run so workers can pick them up again
    await pool.execute(
        "UPDATE transcription_jobs SET status='pending', claimed_at=NULL WHERE status='claimed'"
    )
    n1, n2 = int(r1.split()[-1]), int(r2.split()[-1])
    if n1 or n2:
        logger.warning(
            "Startup recovery: %d downloading→discovered, %d transcribing→discovered",
            n1, n2,
        )
    else:
        logger.info("Startup recovery: no interrupted episodes found")


async def reclaim_stuck_jobs() -> None:
    """
    Reset transcription_jobs stuck in 'claimed' for more than 30 minutes back
    to 'pending'. Runs every 30 minutes.

    A job gets stuck if blurb claimed it but crashed before posting a result.
    Resetting to pending makes it available for the next poll.
    """
    pool = db.get_pool()
    result = await pool.execute(
        """
        UPDATE transcription_jobs
        SET status = 'pending', claimed_at = NULL
        WHERE status = 'claimed'
          AND claimed_at < now() - interval '30 minutes'
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
    """Return scheduler running/paused state and job next-run times."""
    from apscheduler.schedulers.base import STATE_PAUSED
    paused = _scheduler.state == STATE_PAUSED
    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return {"running": _scheduler.running, "paused": paused, "jobs": jobs}


def pause_scheduler() -> None:
    _scheduler.pause()
    logger.info("Scheduler paused via admin")


def resume_scheduler() -> None:
    _scheduler.resume()
    logger.info("Scheduler resumed via admin")
