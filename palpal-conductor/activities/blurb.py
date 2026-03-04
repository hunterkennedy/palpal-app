import logging
import os

import httpx

import db

logger = logging.getLogger(__name__)


async def submit_to_blurb(episode_id: str) -> None:
    """POST the episode's audio file to blurb for transcription."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT audio_path FROM episodes WHERE id = $1::uuid",
        episode_id,
    )
    if not row or not row["audio_path"]:
        raise RuntimeError(f"Episode {episode_id} has no audio_path")

    audio_path: str = row["audio_path"]
    blurb_url = os.environ["BLURB_URL"]
    api_key = os.environ["BLURB_API_KEY"]

    logger.info(
        f"Submitting episode {episode_id} to blurb ({audio_path})"
    )

    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    filename = os.path.basename(audio_path)

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{blurb_url}/jobs",
            data={"job_id": str(episode_id)},
            files={"file": (filename, audio_bytes)},
            headers={"X-API-Key": api_key},
        )

    if response.status_code not in (200, 201, 202):
        raise RuntimeError(
            f"Blurb returned {response.status_code} for episode {episode_id}: "
            f"{response.text[:300]}"
        )

    logger.info(f"Episode {episode_id} submitted to blurb successfully")
