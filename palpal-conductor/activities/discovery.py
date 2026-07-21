import json
import logging
from datetime import datetime
from typing import TypedDict

import caches
import db
import pipeline_settings as settings

logger = logging.getLogger(__name__)


class SourceRow(TypedDict):
    id: str
    url: str
    filters: dict
    podcast_id: str


class NewEpisode(TypedDict):
    episode_id: str
    video_id: str


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
    return [
        SourceRow(id=str(row["id"]), url=row["url"], filters=_coerce_filters(row["filters"]), podcast_id=row["podcast_id"])
        for row in rows
    ]


async def get_enabled_patreon_sources(podcast_id: str | None = None) -> list[SourceRow]:
    """Return enabled Patreon sources, optionally filtered to one podcast."""
    pool = db.get_pool()
    if podcast_id:
        rows = await pool.fetch(
            "SELECT id::text, url, filters, podcast_id FROM sources "
            "WHERE site = 'patreon' AND enabled = TRUE AND podcast_id = $1",
            podcast_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT id::text, url, filters, podcast_id FROM sources "
            "WHERE site = 'patreon' AND enabled = TRUE"
        )
    return [
        SourceRow(id=str(row["id"]), url=row["url"], filters=_coerce_filters(row["filters"]), podcast_id=row["podcast_id"])
        for row in rows
    ]


async def get_source(source_id: str) -> SourceRow | None:
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT id::text, url, filters, podcast_id FROM sources WHERE id = $1::uuid", source_id
    )
    if not row:
        return None
    return SourceRow(id=str(row["id"]), url=row["url"], filters=_coerce_filters(row["filters"]), podcast_id=row["podcast_id"])


async def apply_discovery_results(source_id: str, filters: dict, entries: list[dict]) -> tuple[list[NewEpisode], int]:
    """
    Take raw entries scraped by a blurb 'discover' job and apply them to the DB:
    insert new episodes (skipping unavailable/title_exclude-filtered ones and
    auto-blacklisting ones under the duration floor), retroactively blacklist
    existing episodes whose duration is now known to be too short, orphan
    episodes that are no longer present in the source, and reactivate any
    previously-orphaned episode that has reappeared.

    `entries` must include every item blurb saw in the source, unfiltered —
    filtering and orphan detection both happen here so blurb stays a dumb
    scraper with no source-specific business logic. Each entry:
        {"video_id": str, "title": str, "pub_date": "YYYY-MM-DD" | None, "duration": float | None}

    Returns (newly_inserted_episodes, reactivated_count).
    """
    title_exclude: list[str] = [s.lower() for s in filters.get("title_exclude", [])]
    pool = db.get_pool()
    min_duration = await settings.get_int("min_episode_duration_seconds")

    all_seen_video_ids = [e["video_id"] for e in entries if e.get("video_id")]

    new_episodes: list[NewEpisode] = []
    auto_blacklisted = 0
    retro_count = 0
    orphaned_count = 0
    reactivated_count = 0

    for entry in entries:
        video_id = entry.get("video_id")
        title = entry.get("title") or ""
        if not video_id:
            continue

        # Skip unavailable videos — they still exist in the source, just unplayable
        if title.startswith("[") and title.endswith("]"):
            continue

        if any(excl in title.lower() for excl in title_exclude):
            continue

        duration: float | None = entry.get("duration")
        pub_date_str = entry.get("pub_date")
        pub_date = None
        if pub_date_str:
            try:
                pub_date = datetime.strptime(pub_date_str, "%Y-%m-%d").date()
            except ValueError:
                logger.warning(f"Source {source_id}: bad pub_date {pub_date_str!r} for video {video_id}")

        should_blacklist = min_duration > 0 and duration is not None and duration < min_duration
        blacklist_reason = (
            f"Auto-blacklisted: duration {duration:.0f}s < minimum {min_duration}s"
            if should_blacklist else None
        )

        row = await pool.fetchrow(
            """
            INSERT INTO episodes (source_id, video_id, title, publication_date, duration_seconds, blacklisted, error_message, status)
            VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7, CASE WHEN $6 THEN 'blacklisted' ELSE 'discovered' END)
            ON CONFLICT (source_id, video_id) DO NOTHING
            RETURNING id::text
            """,
            source_id, video_id, title, pub_date, duration, should_blacklist, blacklist_reason,
        )
        if row:
            if should_blacklist:
                auto_blacklisted += 1
                logger.info(f"Auto-blacklisted '{title}' ({duration:.0f}s < {min_duration}s min)")
            else:
                new_episodes.append(NewEpisode(episode_id=row["id"], video_id=video_id))

    logger.info(
        f"Source {source_id}: {len(new_episodes)} new episodes inserted"
        + (f", {auto_blacklisted} auto-blacklisted (too short)" if auto_blacklisted else "")
    )

    # Retroactively blacklist existing unprocessed episodes whose duration is now known
    # and falls below the threshold.
    if min_duration > 0:
        short_video_ids = [
            e["video_id"] for e in entries
            if e.get("duration") is not None and e["duration"] < min_duration
        ]
        if short_video_ids:
            retro = await pool.execute(
                """
                UPDATE episodes
                SET blacklisted     = TRUE,
                    status          = 'blacklisted',
                    error_message   = 'Auto-blacklisted: duration too short',
                    updated_at      = NOW()
                WHERE source_id     = $1::uuid
                  AND video_id      = ANY($2)
                  AND blacklisted   = FALSE
                  AND status NOT IN ('processed', 'downloading')
                """,
                source_id, short_video_ids,
            )
            retro_count = int(retro.split()[-1])
            if retro_count:
                logger.info(f"Source {source_id}: retroactively blacklisted {retro_count} existing episode(s) (too short)")

    # Orphan episodes that are no longer present in the source. In-flight
    # episodes are left alone.
    if all_seen_video_ids:
        orphaned = await pool.execute(
            """
            UPDATE episodes
            SET status = 'orphaned', updated_at = NOW()
            WHERE source_id = $1::uuid
              AND video_id != ALL($2)
              AND status NOT IN ('downloading', 'orphaned')
              AND blacklisted = FALSE
            """,
            source_id, all_seen_video_ids,
        )
        orphaned_count = int(orphaned.split()[-1])
        if orphaned_count:
            logger.info(f"Source {source_id}: orphaned {orphaned_count} episode(s) no longer in source")

        # Reactivate previously-orphaned episodes that have reappeared (e.g. a
        # transient scrape earlier under-reported the source). Restore to
        # 'processed' if a transcript already exists, otherwise back to
        # 'discovered' so the pipeline picks it up again.
        reactivated = await pool.execute(
            """
            UPDATE episodes
            SET status = CASE
                    WHEN EXISTS (SELECT 1 FROM transcript_chunks tc WHERE tc.episode_id = episodes.id)
                    THEN 'processed' ELSE 'discovered'
                END,
                error_message = NULL,
                updated_at = NOW()
            WHERE source_id = $1::uuid
              AND video_id = ANY($2)
              AND status = 'orphaned'
            """,
            source_id, all_seen_video_ids,
        )
        reactivated_count = int(reactivated.split()[-1])
        if reactivated_count:
            logger.info(f"Source {source_id}: reactivated {reactivated_count} previously-orphaned episode(s)")

    if new_episodes or auto_blacklisted or retro_count or orphaned_count or reactivated_count:
        caches.bust_episodes_cache()

    return new_episodes, reactivated_count


async def apply_channel_icon(podcast_id: str, thumbnail_url: str, content_type: str, image_bytes: bytes) -> None:
    """Store a channel icon fetched by blurb during a discover job. No-op if already current."""
    if not podcast_id or not thumbnail_url or not image_bytes:
        return
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT image FROM podcasts WHERE id = $1", podcast_id)
    if not row or row["image"] == thumbnail_url:
        return
    await pool.execute(
        """
        UPDATE podcasts
        SET image = $1, icon = $2, icon_content_type = $3, updated_at = NOW()
        WHERE id = $4
        """,
        thumbnail_url, image_bytes, content_type, podcast_id,
    )
    logger.info(f"Updated channel icon for podcast {podcast_id}")
