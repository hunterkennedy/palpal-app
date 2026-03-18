import asyncio
import glob
import logging
import os
import tempfile
from datetime import date as Date

import db
import pipeline_settings as settings
from activities.utils import yt_dlp_path

logger = logging.getLogger(__name__)


class EpisodeTooShortError(Exception):
    """Raised when yt-dlp skips a video because it's below the minimum duration."""


class EpisodeUnavailableError(Exception):
    """Raised when yt-dlp reports the video is private or unavailable."""


class EpisodeRateLimitedError(Exception):
    """Raised when YouTube rate-limits the download request (transient — will be retried)."""


def _write_patreon_cookie_file(session_cookie: str) -> str:
    """Write a Netscape-format cookie file for yt-dlp. Returns the temp file path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, prefix="patreon_cookies_")
    f.write("# Netscape HTTP Cookie File\n")
    f.write(f".patreon.com\tTRUE\t/\tTRUE\t0\tsession_id\t{session_cookie}\n")
    f.close()
    return f.name


async def download_audio(episode_id: str) -> str:
    """
    Download audio for the episode using yt-dlp.
    Updates episodes.audio_path with the resulting file path.
    Returns the absolute file path.
    Raises EpisodeTooShortError if the video is filtered by min duration.
    """
    pool = db.get_pool()

    row = await pool.fetchrow(
        """
        SELECT e.video_id, s.site
        FROM episodes e
        JOIN sources s ON s.id = e.source_id
        WHERE e.id = $1::uuid
        """,
        episode_id,
    )
    if not row:
        raise RuntimeError(f"Episode {episode_id} not found in DB")

    video_id: str = row["video_id"]
    site: str = row["site"]
    audio_path_dir: str = os.environ.get("AUDIO_PATH", "/tmp")
    output_template = os.path.join(audio_path_dir, f"{episode_id}.%(ext)s")

    if site == "patreon":
        video_url = f"https://www.patreon.com/posts/{video_id}"
    else:
        video_url = f"https://youtube.com/watch?v={video_id}"

    logger.info(f"Downloading audio for episode {episode_id} ({site}/{video_id})")

    min_duration = await settings.get_int("min_episode_duration_seconds")

    cmd = [
        yt_dlp_path(),
        "-x",
        "--audio-format", "best",
        "--no-warnings",
        "--print", "upload_date",
        "--no-simulate",
        "-o", output_template,
    ]

    if site == "patreon":
        session_cookie = await settings.get_string("patreon_session_cookie")
        if session_cookie:
            cookie_file = _write_patreon_cookie_file(session_cookie)
            cmd += ["--cookies", cookie_file]
        else:
            cookie_file = None
    else:
        cookie_file = None
        if min_duration > 0:
            cmd += ["--match-filter", f"duration >= {min_duration}"]

    cmd.append(video_url)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout_bytes, stderr_bytes = await proc.communicate()

    if cookie_file:
        try:
            os.unlink(cookie_file)
        except OSError:
            pass

    if proc.returncode != 0:
        stderr = stderr_bytes.decode()
        if any(phrase in stderr for phrase in ("Private video", "This video is private", "Video unavailable", "This post is")):
            raise EpisodeUnavailableError(f"Content {video_id} is private or unavailable")
        if any(phrase in stderr for phrase in ("HTTP Error 429", "Too Many Requests", "Sign in to confirm")):
            raise EpisodeRateLimitedError(f"Rate limited for {video_id} — will retry next run")
        raise RuntimeError(
            f"yt-dlp download failed for {video_id}: {stderr[:500]}"
        )

    # Find the file that was written (extension unknown until after conversion)
    pattern = os.path.join(audio_path_dir, f"{episode_id}.*")
    matches = glob.glob(pattern)
    if not matches:
        # yt-dlp exited 0 but wrote no file — video was filtered by --match-filter
        raise EpisodeTooShortError(
            f"Skipped by yt-dlp: duration below {min_duration}s minimum"
        )

    file_path = matches[0]
    logger.info(f"Downloaded to {file_path}")

    # Parse upload_date from yt-dlp output ("YYYYMMDD"), backfill if missing in DB
    pub_date: Date | None = None
    upload_date = stdout_bytes.decode().strip()
    if len(upload_date) == 8 and upload_date.isdigit():
        pub_date = Date(int(upload_date[:4]), int(upload_date[4:6]), int(upload_date[6:8]))

    await pool.execute(
        """
        UPDATE episodes
        SET audio_path = $1,
            publication_date = COALESCE(publication_date, $2::date),
            updated_at = NOW()
        WHERE id = $3::uuid
        """,
        file_path,
        pub_date,
        episode_id,
    )

    return file_path
