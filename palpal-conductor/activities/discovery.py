import asyncio
import json
import logging
from typing import TypedDict

import db

logger = logging.getLogger(__name__)


class SourceRow(TypedDict):
    id: str
    url: str
    type: str
    filters: dict
    podcast_id: str


class NewEpisode(TypedDict):
    episode_id: str
    video_id: str


async def get_enabled_youtube_sources(podcast_id: str | None = None) -> list[SourceRow]:
    """Return enabled YouTube sources, optionally filtered to one podcast."""
    pool = db.get_pool()
    if podcast_id:
        rows = await pool.fetch(
            "SELECT id::text, url, type, filters, podcast_id FROM sources "
            "WHERE site = 'youtube' AND enabled = TRUE AND podcast_id = $1",
            podcast_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT id::text, url, type, filters, podcast_id FROM sources "
            "WHERE site = 'youtube' AND enabled = TRUE"
        )
    return [
        SourceRow(
            id=str(row["id"]),
            url=row["url"],
            type=row["type"],
            filters=dict(row["filters"]) if row["filters"] else {},
            podcast_id=row["podcast_id"],
        )
        for row in rows
    ]


async def discover_youtube_source(
    source_id: str,
    url: str,
    source_type: str,
    filters: dict,
) -> list[NewEpisode]:
    """
    Run yt-dlp --flat-playlist against the source URL, insert new episodes,
    and return NewEpisode dicts for every newly inserted row.
    """
    logger.info(f"Discovering source {source_id} ({url})")

    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        url,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"yt-dlp failed for {url}: {stderr_bytes.decode()[:500]}"
        )

    title_exclude: list[str] = [
        s.lower() for s in filters.get("title_exclude", [])
    ]
    max_new: int | None = filters.get("max_new")  # cap new episodes per run

    entries: list[dict] = []
    for line in stdout_bytes.decode().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        video_id = entry.get("id")
        title = entry.get("title") or ""
        upload_date = entry.get("upload_date")  # "YYYYMMDD" or None

        if not video_id:
            continue

        # Apply title_exclude filter
        if any(excl in title.lower() for excl in title_exclude):
            logger.debug(f"Skipping '{title}' (title_exclude match)")
            continue

        # Parse upload_date → DATE string
        pub_date: str | None = None
        if upload_date and len(upload_date) == 8:
            pub_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"

        entries.append(
            {"video_id": video_id, "title": title, "pub_date": pub_date}
        )

    logger.info(
        f"Source {source_id}: {len(entries)} entries from yt-dlp"
    )

    if not entries:
        return []

    # Bulk-insert with RETURNING to get only newly inserted IDs
    pool = db.get_pool()
    new_episodes: list[NewEpisode] = []

    for entry in entries:
        row = await pool.fetchrow(
            """
            INSERT INTO episodes (source_id, video_id, title, publication_date)
            VALUES ($1::uuid, $2, $3, $4::date)
            ON CONFLICT (source_id, video_id) DO NOTHING
            RETURNING id::text
            """,
            source_id,
            entry["video_id"],
            entry["title"],
            entry["pub_date"],
        )
        if row:
            new_episodes.append(
                NewEpisode(episode_id=row["id"], video_id=entry["video_id"])
            )

    if max_new is not None and len(new_episodes) > max_new:
        logger.info(
            f"Source {source_id}: capping at {max_new} of {len(new_episodes)} new episodes (max_new filter)"
        )
        new_episodes = new_episodes[:max_new]

    logger.info(
        f"Source {source_id}: {len(new_episodes)} new episodes inserted"
    )
    return new_episodes
