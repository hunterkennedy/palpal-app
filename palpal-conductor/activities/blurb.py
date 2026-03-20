import logging

import db

logger = logging.getLogger(__name__)


async def enqueue_transcription(episode_id: str, audio_path: str) -> str:
    """
    Insert a pending transcription job for a pull worker to claim.
    Returns the job UUID.
    """
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO transcription_jobs (episode_id, audio_path)
        VALUES ($1::uuid, $2)
        RETURNING id::text
        """,
        episode_id, audio_path,
    )
    logger.info(f"Enqueued transcription job {row['id']} for episode {episode_id}")
    return row["id"]
