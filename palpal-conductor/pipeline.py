import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

import db
from activities.discovery import get_enabled_youtube_sources, discover_youtube_source
from activities.download import download_audio
from activities.blurb import submit_to_blurb

logger = logging.getLogger(__name__)

_download_sem = asyncio.Semaphore(1)
_scheduler = AsyncIOScheduler()


async def run_episode(episode_id: str) -> None:
    pool = db.get_pool()
    try:
        async with _download_sem:
            await pool.execute(
                "UPDATE episodes SET status='downloading' WHERE id=$1::uuid", episode_id
            )
            await download_audio(episode_id)

        await pool.execute(
            "UPDATE episodes SET status='transcribing' WHERE id=$1::uuid", episode_id
        )
        await submit_to_blurb(episode_id)

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
    sources = await get_enabled_youtube_sources(podcast_id=podcast_id)
    total_new: list[str] = []
    for source in sources:
        try:
            new_episodes = await discover_youtube_source(
                source["id"], source["url"], source["type"], source["filters"]
            )
            for ep in new_episodes:
                total_new.append(ep["episode_id"])
                if auto_queue:
                    asyncio.create_task(run_episode(ep["episode_id"]))
        except Exception as exc:
            logger.error(f"Discovery failed for source {source['id']}: {exc}")
    logger.info(f"Discovery run complete (podcast={label}): {len(total_new)} new, queued={auto_queue}")
    return {"sources": len(sources), "new_episodes": len(total_new), "queued": auto_queue}


async def resubmit_stuck() -> None:
    """
    Resubmit episodes stuck in transcribing.

    Runs daily at 10 AM, when blurb is expected to be back online after the
    PC has been off overnight. Episodes stay in 'transcribing' until blurb
    webhooks back — this job catches anything that was left hanging.
    """
    pool = db.get_pool()
    rows = await pool.fetch(
        "SELECT id FROM episodes WHERE status='transcribing'"
    )
    if not rows:
        logger.info("Recovery: no stuck episodes")
        return
    logger.info(f"Recovery: resubmitting {len(rows)} stuck episode(s)")
    for row in rows:
        logger.warning(f"Resubmitting stuck episode {row['id']}")
        try:
            await submit_to_blurb(str(row["id"]))
        except Exception as exc:
            logger.error(f"Resubmit failed for {row['id']}: {exc}")


def start_scheduler() -> None:
    _scheduler.add_job(run_discovery, "interval", hours=24, id="discovery")
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
