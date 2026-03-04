import asyncio
import glob
import logging
import os

import db

logger = logging.getLogger(__name__)


async def download_audio(episode_id: str) -> str:
    """
    Download audio for the episode using yt-dlp.
    Updates episodes.audio_path with the resulting file path.
    Returns the absolute file path.
    """
    pool = db.get_pool()

    row = await pool.fetchrow(
        "SELECT video_id FROM episodes WHERE id = $1::uuid",
        episode_id,
    )
    if not row:
        raise RuntimeError(f"Episode {episode_id} not found in DB")

    video_id: str = row["video_id"]
    audio_path_dir: str = os.environ.get("AUDIO_PATH", "/audio")
    output_template = os.path.join(audio_path_dir, f"{episode_id}.%(ext)s")
    video_url = f"https://youtube.com/watch?v={video_id}"

    logger.info(f"Downloading audio for episode {episode_id} ({video_id})")

    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "best",
        "--no-warnings",
        "-o", output_template,
        video_url,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    await proc.wait()
    stderr_bytes = await proc.stderr.read()
    if proc.returncode != 0:
        raise RuntimeError(
            f"yt-dlp download failed for {video_id}: {stderr_bytes.decode()[:500]}"
        )

    # Find the file that was written (extension unknown until after conversion)
    pattern = os.path.join(audio_path_dir, f"{episode_id}.*")
    matches = glob.glob(pattern)
    if not matches:
        raise RuntimeError(
            f"yt-dlp completed but no file found matching {pattern}"
        )

    file_path = matches[0]
    logger.info(f"Downloaded to {file_path}")

    await pool.execute(
        "UPDATE episodes SET audio_path = $1, updated_at = NOW() WHERE id = $2::uuid",
        file_path,
        episode_id,
    )

    return file_path
