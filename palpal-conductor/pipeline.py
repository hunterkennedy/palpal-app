import asyncio
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
from activities.blurb import transcribe_episode
from activities.process import process_transcript

logger = logging.getLogger(__name__)

_download_sem = asyncio.Semaphore(int(os.environ.get("DOWNLOAD_CONCURRENCY", 1)))
_transcribe_sem = asyncio.Semaphore(int(os.environ.get("TRANSCRIBE_CONCURRENCY", 1)))
_scheduler = AsyncIOScheduler()


async def submit_downloaded_episode(episode_id: str) -> None:
    """Transcribe a downloaded episode via blurb (polling) and process the result."""
    pool = db.get_pool()
    async with _transcribe_sem:
        await pool.execute(
            "UPDATE episodes SET status='transcribing' WHERE id=$1::uuid", episode_id
        )
        try:
            target_words = await settings.get_int("chunk_target_words") or 50
            result = await transcribe_episode(episode_id)
            await process_transcript(episode_id, result, target_words=target_words)
            await pool.execute(
                "UPDATE episodes SET status='processed' WHERE id=$1::uuid", episode_id
            )
            logger.info(f"Episode {episode_id} transcribed and processed successfully")
        except Exception as exc:
            logger.error(f"Transcription failed for {episode_id}: {exc}")
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
            await download_audio(episode_id)

        # Safe checkpoint: audio is on disk
        await pool.execute(
            "UPDATE episodes SET status='downloaded' WHERE id=$1::uuid", episode_id
        )
        if await settings.get("auto_transcribe"):
            await submit_downloaded_episode(episode_id)
        else:
            logger.info("Episode %s downloaded; auto_transcribe is off, stopping here", episode_id)

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
    On startup, reset any episodes stuck in 'downloading' back to 'discovered'.

    If the conductor was killed or restarted while a download was in progress,
    the episode stays in 'downloading' indefinitely because there is no running
    task to advance it. Resetting to 'discovered' lets the next manual trigger
    or scheduled discovery pick it up cleanly.
    """
    pool = db.get_pool()
    # Episodes stuck in 'downloading' with audio already on disk → skip re-download
    r_dl_done = await pool.execute(
        """
        UPDATE episodes
        SET status = 'downloaded', error_message = 'Reset: download completed but status not updated before restart'
        WHERE status = 'downloading' AND audio_path IS NOT NULL AND blacklisted = FALSE
        """
    )
    # Episodes stuck in 'downloading' with no audio → full restart
    r1 = await pool.execute(
        """
        UPDATE episodes
        SET status = 'discovered', error_message = 'Reset: download interrupted by conductor restart'
        WHERE status = 'downloading' AND audio_path IS NULL AND blacklisted = FALSE
        """
    )
    r2 = await pool.execute(
        """
        UPDATE episodes
        SET status = 'downloaded', error_message = 'Reset: transcription interrupted by conductor restart'
        WHERE status = 'transcribing' AND audio_path IS NOT NULL AND blacklisted = FALSE
        """
    )
    n_dl_done = int(r_dl_done.split()[-1])
    n1, n2 = int(r1.split()[-1]), int(r2.split()[-1])
    if n_dl_done or n1 or n2:
        logger.warning(
            "Startup recovery: %d downloading→downloaded (audio on disk), "
            "%d downloading→discovered (no audio), %d transcribing→downloaded",
            n_dl_done, n1, n2,
        )
    else:
        logger.info("Startup recovery: no interrupted episodes found")


async def resubmit_stuck() -> None:
    """
    Resubmit episodes stuck in transcribing.

    Runs daily at 10 AM. With polling-based blurb, a stuck 'transcribing'
    episode means the conductor task died mid-poll. Reset to 'downloaded'
    and resubmit so they get picked up by the transcription semaphore.
    """
    pool = db.get_pool()
    rows = await pool.fetch(
        "SELECT id FROM episodes WHERE status='transcribing' AND blacklisted = FALSE"
    )
    if not rows:
        logger.info("Recovery: no stuck transcribing episodes")
        return
    logger.info(f"Recovery: resubmitting {len(rows)} stuck episode(s)")
    for row in rows:
        logger.warning(f"Resubmitting stuck episode {row['id']}")
        await pool.execute(
            "UPDATE episodes SET status='downloaded' WHERE id=$1::uuid", row['id']
        )
        asyncio.create_task(submit_downloaded_episode(str(row["id"])))


async def scheduled_discovery() -> None:
    """Scheduled wrapper — skipped when auto_discover is off."""
    if not await settings.get("auto_discover"):
        logger.info("Scheduled discovery skipped (auto_discover=false)")
        return
    await run_discovery(auto_queue=True)


def start_scheduler() -> None:
    _scheduler.add_job(scheduled_discovery, "interval", hours=24, id="discovery")
    # Recovery runs at 10 AM daily — blurb lives on a PC that goes offline
    # overnight and is not expected back until the next morning.
    _scheduler.add_job(resubmit_stuck, "cron", hour=10, minute=0, id="recovery")
    _scheduler.start()
    logger.info("Scheduler started (discovery every 24h, recovery daily at 10:00)")


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
