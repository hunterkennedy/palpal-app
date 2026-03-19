import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

POLL_INTERVAL = int(os.environ.get("BLURB_POLL_INTERVAL", 15))   # seconds between status checks
POLL_TIMEOUT  = int(os.environ.get("BLURB_POLL_TIMEOUT", 7200))  # give up after 2 hours


async def transcribe_episode(episode_id: str, audio_path: str) -> dict:
    """
    Submit the episode's audio to blurb, poll until complete, and return the result.

    Returns the result dict: {text, language, segments}.
    Raises RuntimeError on any failure.
    """
    blurb_url = os.environ["BLURB_URL"]
    api_key   = os.environ["BLURB_API_KEY"]
    headers   = {"X-API-Key": api_key}

    logger.info(f"Submitting episode {episode_id} to blurb ({audio_path})")

    filename = os.path.basename(audio_path)

    try:
        async with httpx.AsyncClient(timeout=600) as client:
            with open(audio_path, "rb") as f:
                res = await client.post(
                    f"{blurb_url}/jobs",
                    data={"job_id": str(episode_id)},
                    files={"file": (filename, f)},
                    headers=headers,
                )
    finally:
        try:
            os.unlink(audio_path)
            logger.info(f"Deleted ephemeral audio file {audio_path}")
        except OSError:
            pass

    if res.status_code not in (200, 201, 202):
        raise RuntimeError(
            f"Blurb rejected submission for {episode_id} "
            f"({res.status_code}): {res.text[:300]}"
        )

    logger.info(f"Episode {episode_id} queued in blurb, polling for result...")

    # Poll until done
    elapsed = 0
    async with httpx.AsyncClient(timeout=30) as client:
        while elapsed < POLL_TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            status_res = await client.get(
                f"{blurb_url}/jobs/{episode_id}",
                headers=headers,
            )

            if status_res.status_code != 200:
                logger.warning(
                    f"Blurb status check for {episode_id} returned {status_res.status_code}"
                )
                continue

            job = status_res.json()
            status = job.get("status")
            logger.info(f"Episode {episode_id} blurb status: {status} ({elapsed}s elapsed)")

            if status == "completed":
                # Fetch result (also deletes the job from blurb memory)
                result_res = await client.get(
                    f"{blurb_url}/jobs/{episode_id}/result",
                    headers=headers,
                )
                if result_res.status_code != 200:
                    raise RuntimeError(
                        f"Blurb result fetch failed for {episode_id} "
                        f"({result_res.status_code}): {result_res.text[:300]}"
                    )
                return result_res.json()

            if status == "failed":
                error = job.get("error", "unknown error")
                raise RuntimeError(f"Blurb transcription failed for {episode_id}: {error}")

    raise RuntimeError(
        f"Blurb transcription timed out for {episode_id} after {POLL_TIMEOUT}s"
    )
