import asyncio
import json
import logging
from typing import TypedDict

import httpx

import db
import pipeline_settings as settings
from activities.utils import yt_dlp_path

logger = logging.getLogger(__name__)


class SourceRow(TypedDict):
    id: str
    url: str
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
            "SELECT id::text, url, filters, podcast_id FROM sources "
            "WHERE site = 'youtube' AND enabled = TRUE AND podcast_id = $1",
            podcast_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT id::text, url, filters, podcast_id FROM sources "
            "WHERE site = 'youtube' AND enabled = TRUE"
        )
    def _coerce_filters(f) -> dict:
        if isinstance(f, dict):
            return f
        if isinstance(f, str):
            try:
                parsed = json.loads(f)
                return parsed if isinstance(parsed, dict) else {}
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}

    return [
        SourceRow(
            id=str(row["id"]),
            url=row["url"],
            filters=_coerce_filters(row["filters"]),
            podcast_id=row["podcast_id"],
        )
        for row in rows
    ]


async def fetch_channel_icon(podcast_id: str, source_url: str) -> None:
    """
    Fetch the YouTube channel avatar for a podcast using the channel/playlist URL.
    Downloads the image bytes and stores them in podcasts.icon.
    No-op if the icon is already up to date or if anything fails.
    """
    try:
        cmd = [
            yt_dlp_path(),
            "--dump-single-json",
            "--no-warnings",
            "--flat-playlist",
            "--playlist-items", "0",
            source_url,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, _ = await proc.communicate()
        if proc.returncode != 0 or not stdout_bytes:
            return

        info = json.loads(stdout_bytes.decode())
        thumbnails: list[dict] = info.get("thumbnails") or []

        # Prefer avatar_uncropped, then highest preference value
        avatar = next((t for t in thumbnails if t.get("id") == "avatar_uncropped"), None)
        if not avatar:
            avatar = max(
                (t for t in thumbnails if t.get("url")),
                key=lambda t: t.get("preference", 0),
                default=None,
            )
        if not avatar:
            return

        thumbnail_url = avatar["url"]

        pool = db.get_pool()
        row = await pool.fetchrow("SELECT image FROM podcasts WHERE id = $1", podcast_id)
        if not row:
            return
        if row["image"] == thumbnail_url:
            return  # already current

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(thumbnail_url)
        if resp.status_code != 200:
            return

        content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        await pool.execute(
            """
            UPDATE podcasts
            SET image = $1, icon = $2, icon_content_type = $3, updated_at = NOW()
            WHERE id = $4
            """,
            thumbnail_url,
            resp.content,
            content_type,
            podcast_id,
        )
        logger.info(f"Updated channel icon for podcast {podcast_id}")
    except Exception as exc:
        logger.warning(f"fetch_channel_icon failed for podcast {podcast_id}: {exc}")


async def discover_youtube_source(
    source_id: str,
    url: str,
    filters: dict,
    podcast_id: str = "",
) -> list[NewEpisode]:
    """
    Run yt-dlp --flat-playlist against the source URL, insert new episodes,
    and return NewEpisode dicts for every newly inserted row.
    """
    logger.info(f"Discovering source {source_id} ({url})")

    cmd = [
        yt_dlp_path(),
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

        # Skip unavailable videos — they'll be re-evaluated on the next discovery run
        if title.startswith("[") and title.endswith("]"):
            logger.debug(f"Skipping unavailable video {video_id} ('{title}')")
            continue

        # Apply title_exclude filter
        if any(excl in title.lower() for excl in title_exclude):
            logger.debug(f"Skipping '{title}' (title_exclude match)")
            continue

        # Parse upload_date → DATE string
        pub_date: str | None = None
        if upload_date and len(upload_date) == 8:
            pub_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"

        duration: float | None = entry.get("duration")

        entries.append(
            {"video_id": video_id, "title": title, "pub_date": pub_date, "duration": duration}
        )

    logger.info(
        f"Source {source_id}: {len(entries)} entries from yt-dlp"
    )

    if not entries:
        return []

    # Bulk-insert with RETURNING to get only newly inserted IDs
    pool = db.get_pool()
    min_duration = await settings.get_int("min_episode_duration_seconds")
    durations = [e["duration"] for e in entries]
    none_count = sum(1 for d in durations if d is None)
    logger.info(
        f"Source {source_id}: min_duration={min_duration}s, "
        f"duration missing for {none_count}/{len(entries)} entries"
    )
    new_episodes: list[NewEpisode] = []
    auto_blacklisted = 0

    for entry in entries:
        duration: float | None = entry["duration"]
        should_blacklist = (
            min_duration > 0
            and duration is not None
            and duration < min_duration
        )
        blacklist_reason = (
            f"Auto-blacklisted: duration {duration:.0f}s < minimum {min_duration}s"
            if should_blacklist else None
        )
        row = await pool.fetchrow(
            """
            INSERT INTO episodes (source_id, video_id, title, publication_date, duration_seconds, blacklisted, error_message)
            VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7)
            ON CONFLICT (source_id, video_id) DO NOTHING
            RETURNING id::text
            """,
            source_id,
            entry["video_id"],
            entry["title"],
            entry["pub_date"],
            duration,
            should_blacklist,
            blacklist_reason,
        )
        if row:
            if should_blacklist:
                auto_blacklisted += 1
                logger.info(f"Auto-blacklisted '{entry['title']}' ({duration:.0f}s < {min_duration}s min)")
            else:
                new_episodes.append(
                    NewEpisode(episode_id=row["id"], video_id=entry["video_id"])
                )

    logger.info(
        f"Source {source_id}: {len(new_episodes)} new episodes inserted"
        + (f", {auto_blacklisted} auto-blacklisted (too short)" if auto_blacklisted else "")
    )

    # Retroactively blacklist existing unprocessed episodes whose duration is now known
    # and falls below the threshold. This catches episodes inserted before the setting
    # was configured, or before duration data was available.
    if min_duration > 0:
        short_video_ids = [
            e["video_id"]
            for e in entries
            if e["duration"] is not None and e["duration"] < min_duration
        ]
        if short_video_ids:
            retro = await pool.execute(
                """
                UPDATE episodes
                SET blacklisted     = TRUE,
                    error_message   = 'Auto-blacklisted: duration too short',
                    updated_at      = NOW()
                WHERE source_id     = $1::uuid
                  AND video_id      = ANY($2)
                  AND blacklisted   = FALSE
                  AND status NOT IN ('processed', 'downloading', 'transcribing')
                """,
                source_id,
                short_video_ids,
            )
            retro_count = int(retro.split()[-1])
            if retro_count:
                logger.info(
                    f"Source {source_id}: retroactively blacklisted {retro_count} existing episode(s) (too short)"
                )

    # Update channel icon using the source URL (channel/playlist page)
    if podcast_id:
        asyncio.create_task(fetch_channel_icon(podcast_id, url))

    return new_episodes
