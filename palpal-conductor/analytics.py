"""Privacy-preserving search analytics.

Only daily aggregates are persisted. There are no event-level rows, IP
addresses, user/session IDs, user agents, or query-to-click links in Postgres.

Unique searchers are estimated in memory: each client IP is HMAC'd with a
random secret that is rotated at Pacific midnight and never written to disk.
Only the resulting daily count is saved.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import secrets
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import db
import pipeline_settings

logger = logging.getLogger(__name__)

TIMEZONE_NAME = "America/Los_Angeles"
TIMEZONE = ZoneInfo(TIMEZONE_NAME)
MAX_QUERY_LENGTH = 200
MAX_PODCAST_IDS = 10

_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_URL_RE = re.compile(r"(https?://|www\.)", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\s().-]?){7,}\d(?!\d)")
_LONG_DIGITS_RE = re.compile(r"\d{7,}")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_WHITESPACE_RE = re.compile(r"\s+")

_TABLES = (
    "analytics_search_daily",
    "analytics_query_daily",
    "analytics_podcast_daily",
    "analytics_clip_daily",
)

# In-memory state. Restarting conductor resets the daily salt and visitor set;
# the database keeps the maximum count seen for the day.
_salt: bytes = secrets.token_bytes(32)
_salt_day: date = datetime.now(TIMEZONE).date()
_visitors: set[bytes] = set()


def today() -> date:
    """The current analytics day in Pacific time."""
    return datetime.now(TIMEZONE).date()


def reset_memory() -> None:
    """Forget the current day's in-memory visitor hashes and rotate the salt."""
    global _salt, _salt_day, _visitors
    _salt = secrets.token_bytes(32)
    _salt_day = today()
    _visitors = set()


def _rotate_day() -> None:
    global _salt, _salt_day, _visitors
    current = today()
    if current != _salt_day:
        _salt = secrets.token_bytes(32)
        _salt_day = current
        _visitors = set()


def normalize_query(raw: str) -> str | None:
    """Normalize a query for aggregation, or return None if it looks like PII.

    Empty queries and anything containing an email address, URL, phone number,
    or long digit run are not stored as text. The search is still counted in
    the daily totals.
    """
    text = _CONTROL_RE.sub(" ", raw or "")
    text = _WHITESPACE_RE.sub(" ", text).strip().lower()
    if not text:
        return None

    if (
        _EMAIL_RE.search(text)
        or _URL_RE.search(text)
        or _PHONE_RE.search(text)
        or _LONG_DIGITS_RE.search(text)
    ):
        return None

    if len(text) > MAX_QUERY_LENGTH:
        text = text[:MAX_QUERY_LENGTH].rstrip()
    return text or None


def _clean_id(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value or len(value) > 100:
        return None
    return value


def _clean_ids(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    for value in values:
        cleaned_value = _clean_id(value)
        if cleaned_value and cleaned_value not in cleaned:
            cleaned.append(cleaned_value)
        if len(cleaned) >= MAX_PODCAST_IDS:
            break
    return cleaned


def _note_visitor(client_ip: str | None) -> int:
    """Add the IP's daily hash to the in-memory set and return the set size."""
    _rotate_day()
    if client_ip:
        digest = hmac.new(
            _salt,
            client_ip.encode("utf-8", "ignore"),
            hashlib.sha256,
        ).digest()[:16]
        _visitors.add(digest)
    return len(_visitors)


def _row_count(result: str) -> int:
    try:
        return int(result.split()[-1])
    except (ValueError, IndexError):
        return 0


def _as_int(value) -> int:
    return int(value) if value is not None else 0


async def record_search(
    *,
    query: str,
    result_count: int,
    podcast_filter: str | None,
    top_podcast_ids: list[str],
    corrected: bool,
    client_ip: str | None,
) -> bool:
    """Record one intentional search. Returns False when analytics is disabled."""
    if not await pipeline_settings.get("analytics_enabled", default=False):
        return False

    store_queries = await pipeline_settings.get("analytics_store_queries", default=True)
    normalized_query = normalize_query(query) if store_queries else None
    podcast_filter = _clean_id(podcast_filter)
    top_podcast_ids = _clean_ids(top_podcast_ids)

    _rotate_day()
    day = _salt_day
    unique_searchers = _note_visitor(client_ip)
    zero_result = 1 if result_count <= 0 else 0
    corrected_flag = 1 if corrected else 0

    pool = db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO analytics_search_daily
                    (day, searches, zero_result_searches, corrected_searches,
                     unique_searchers, opens)
                VALUES ($1, 1, $2, $3, $4, 0)
                ON CONFLICT (day) DO UPDATE SET
                    searches = analytics_search_daily.searches + 1,
                    zero_result_searches = analytics_search_daily.zero_result_searches
                        + EXCLUDED.zero_result_searches,
                    corrected_searches = analytics_search_daily.corrected_searches
                        + EXCLUDED.corrected_searches,
                    unique_searchers = GREATEST(
                        analytics_search_daily.unique_searchers,
                        EXCLUDED.unique_searchers
                    ),
                    updated_at = NOW()
                """,
                day, zero_result, corrected_flag, unique_searchers,
            )

            if normalized_query:
                await conn.execute(
                    """
                    INSERT INTO analytics_query_daily
                        (day, query, searches, zero_result_searches)
                    VALUES ($1, $2, 1, $3)
                    ON CONFLICT (day, query) DO UPDATE SET
                        searches = analytics_query_daily.searches + 1,
                        zero_result_searches = analytics_query_daily.zero_result_searches
                            + EXCLUDED.zero_result_searches
                    """,
                    day, normalized_query, zero_result,
                )

            if podcast_filter:
                await conn.execute(
                    """
                    INSERT INTO analytics_podcast_daily
                        (day, podcast_id, filtered_searches)
                    VALUES ($1, $2, 1)
                    ON CONFLICT (day, podcast_id) DO UPDATE SET
                        filtered_searches = analytics_podcast_daily.filtered_searches + 1
                    """,
                    day, podcast_filter,
                )

            if top_podcast_ids:
                await conn.executemany(
                    """
                    INSERT INTO analytics_podcast_daily
                        (day, podcast_id, impressions)
                    VALUES ($1, $2, 1)
                    ON CONFLICT (day, podcast_id) DO UPDATE SET
                        impressions = analytics_podcast_daily.impressions + 1
                    """,
                    [(day, podcast_id) for podcast_id in top_podcast_ids],
                )

    return True


async def record_open(
    *,
    podcast_id: str,
    episode_id: UUID | None = None,
    chunk_id: UUID | None = None,
    source_site: str | None = None,
) -> bool:
    """Record one outbound result-link open. Never linked to a search."""
    if not await pipeline_settings.get("analytics_enabled", default=False):
        return False

    podcast_id = _clean_id(podcast_id)
    if not podcast_id:
        return False

    source_site = (source_site or "").strip()[:50] or None
    day = today()
    pool = db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO analytics_search_daily (day, opens)
                VALUES ($1, 1)
                ON CONFLICT (day) DO UPDATE SET
                    opens = analytics_search_daily.opens + 1,
                    updated_at = NOW()
                """,
                day,
            )

            await conn.execute(
                """
                INSERT INTO analytics_podcast_daily (day, podcast_id, opens)
                VALUES ($1, $2, 1)
                ON CONFLICT (day, podcast_id) DO UPDATE SET
                    opens = analytics_podcast_daily.opens + 1
                """,
                day, podcast_id,
            )

            if chunk_id:
                await conn.execute(
                    """
                    INSERT INTO analytics_clip_daily
                        (day, chunk_id, episode_id, podcast_id, source_site, opens)
                    VALUES ($1, $2, $3, $4, $5, 1)
                    ON CONFLICT (day, chunk_id) DO UPDATE SET
                        opens = analytics_clip_daily.opens + 1,
                        episode_id = COALESCE(
                            EXCLUDED.episode_id,
                            analytics_clip_daily.episode_id
                        ),
                        podcast_id = EXCLUDED.podcast_id,
                        source_site = COALESCE(
                            EXCLUDED.source_site,
                            analytics_clip_daily.source_site
                        )
                    """,
                    day, chunk_id, episode_id, podcast_id, source_site,
                )

    return True


async def purge_old_analytics() -> dict[str, int]:
    """Apply the configured retention windows."""
    query_days = await pipeline_settings.get_int(
        "analytics_query_retention_days", default=180
    )
    aggregate_days = await pipeline_settings.get_int(
        "analytics_aggregate_retention_days", default=730
    )

    pool = db.get_pool()
    current_day = today()
    deleted: dict[str, int] = {}

    if query_days > 0:
        result = await pool.execute(
            "DELETE FROM analytics_query_daily WHERE day < $1",
            current_day - timedelta(days=query_days),
        )
        deleted["analytics_query_daily"] = _row_count(result)

    if aggregate_days > 0:
        cutoff = current_day - timedelta(days=aggregate_days)
        for table in (
            "analytics_search_daily",
            "analytics_podcast_daily",
            "analytics_clip_daily",
        ):
            result = await pool.execute(
                f"DELETE FROM {table} WHERE day < $1",
                cutoff,
            )
            deleted[table] = _row_count(result)

    if any(deleted.values()):
        logger.info("Analytics retention: %s", deleted)
    return deleted


async def purge_all() -> dict[str, int]:
    """Delete every analytics aggregate and reset the in-memory counter."""
    pool = db.get_pool()
    deleted: dict[str, int] = {}
    for table in _TABLES:
        result = await pool.execute(f"DELETE FROM {table}")
        deleted[table] = _row_count(result)
    reset_memory()
    logger.info("Analytics: purged all data %s", deleted)
    return deleted


async def dashboard(
    *,
    days: int = 30,
    min_query_count: int = 1,
    limit: int = 50,
) -> dict:
    """Return the aggregate data needed by the admin analytics view."""
    end = today()
    start = end - timedelta(days=days - 1)
    pool = db.get_pool()
    query_retention_days = await pipeline_settings.get_int(
        "analytics_query_retention_days", default=180
    )
    aggregate_retention_days = await pipeline_settings.get_int(
        "analytics_aggregate_retention_days", default=730
    )

    daily_rows, query_rows, zero_rows, podcast_rows, clip_rows = await asyncio.gather(
        pool.fetch(
            """
            SELECT d::date AS day,
                   COALESCE(s.searches, 0) AS searches,
                   COALESCE(s.unique_searchers, 0) AS unique_searchers,
                   COALESCE(s.zero_result_searches, 0) AS zero_result_searches,
                   COALESCE(s.corrected_searches, 0) AS corrected_searches,
                   COALESCE(s.opens, 0) AS opens
            FROM generate_series($1::date, $2::date, '1 day') AS d
            LEFT JOIN analytics_search_daily s ON s.day = d::date
            ORDER BY d
            """,
            start, end,
        ),
        pool.fetch(
            """
            SELECT query,
                   SUM(searches)::bigint AS searches,
                   SUM(zero_result_searches)::bigint AS zero_result_searches
            FROM analytics_query_daily
            WHERE day >= $1 AND day <= $2
            GROUP BY query
            HAVING SUM(searches) >= $3
            ORDER BY searches DESC, query ASC
            LIMIT $4
            """,
            start, end, min_query_count, limit,
        ),
        pool.fetch(
            """
            SELECT query,
                   SUM(searches)::bigint AS searches,
                   SUM(zero_result_searches)::bigint AS zero_result_searches
            FROM analytics_query_daily
            WHERE day >= $1 AND day <= $2
            GROUP BY query
            HAVING SUM(zero_result_searches) > 0
               AND SUM(searches) >= $3
            ORDER BY zero_result_searches DESC, searches DESC, query ASC
            LIMIT $4
            """,
            start, end, min_query_count, limit,
        ),
        pool.fetch(
            """
            SELECT p.id AS podcast_id, p.display_name, p.enabled,
                   COALESCE(SUM(a.impressions), 0) AS impressions,
                   COALESCE(SUM(a.filtered_searches), 0) AS filtered_searches,
                   COALESCE(SUM(a.opens), 0) AS opens,
                   MAX(a.day) FILTER (WHERE a.opens > 0) AS last_open
            FROM podcasts p
            LEFT JOIN analytics_podcast_daily a
              ON a.podcast_id = p.id
             AND a.day >= $1 AND a.day <= $2
            GROUP BY p.id, p.display_name, p.enabled
            ORDER BY opens DESC, impressions DESC, p.display_name
            """,
            start, end,
        ),
        pool.fetch(
            """
            WITH clip_counts AS (
                SELECT chunk_id,
                       MAX(episode_id::text) AS episode_id,
                       MAX(podcast_id) AS podcast_id,
                       MAX(source_site) AS source_site,
                       SUM(opens) AS opens,
                       MAX(day) AS last_opened
                FROM analytics_clip_daily
                WHERE day >= $1 AND day <= $2
                GROUP BY chunk_id
            )
            SELECT c.chunk_id::text, c.episode_id, c.podcast_id,
                   p.display_name AS podcast_name,
                   tc.episode_title, tc.start_formatted,
                   LEFT(tc.text, 280) AS text,
                   c.source_site, c.opens, c.last_opened
            FROM clip_counts c
            LEFT JOIN podcasts p ON p.id = c.podcast_id
            LEFT JOIN transcript_chunks tc ON tc.id = c.chunk_id
            ORDER BY c.opens DESC, c.last_opened DESC
            LIMIT $3
            """,
            start, end, limit,
        ),
    )

    daily = [
        {
            "day": row["day"].isoformat(),
            "searches": _as_int(row["searches"]),
            "unique_searchers": _as_int(row["unique_searchers"]),
            "zero_result_searches": _as_int(row["zero_result_searches"]),
            "corrected_searches": _as_int(row["corrected_searches"]),
            "opens": _as_int(row["opens"]),
        }
        for row in daily_rows
    ]

    total_searches = sum(row["searches"] for row in daily)
    total_unique = sum(row["unique_searchers"] for row in daily)
    total_zero = sum(row["zero_result_searches"] for row in daily)
    total_corrected = sum(row["corrected_searches"] for row in daily)
    total_opens = sum(row["opens"] for row in daily)

    queries = [
        {
            "query": row["query"],
            "searches": _as_int(row["searches"]),
            "zero_result_searches": _as_int(row["zero_result_searches"]),
        }
        for row in query_rows
    ]
    for row in queries:
        row["zero_result_rate"] = (
            round(row["zero_result_searches"] / row["searches"], 4)
            if row["searches"] else 0.0
        )

    zero_queries = [
        {
            "query": row["query"],
            "searches": _as_int(row["searches"]),
            "zero_result_searches": _as_int(row["zero_result_searches"]),
        }
        for row in zero_rows
    ]

    podcasts = []
    for row in podcast_rows:
        impressions = _as_int(row["impressions"])
        opens = _as_int(row["opens"])
        podcasts.append({
            "podcast_id": row["podcast_id"],
            "display_name": row["display_name"],
            "enabled": row["enabled"],
            "impressions": impressions,
            "filtered_searches": _as_int(row["filtered_searches"]),
            "opens": opens,
            "open_rate": round(opens / impressions, 4) if impressions else 0.0,
            "last_open": row["last_open"].isoformat() if row["last_open"] else None,
        })

    review_candidates = [
        podcast for podcast in podcasts
        if podcast["opens"] == 0 and podcast["impressions"] >= 25
    ][:20]

    clips = [
        {
            "chunk_id": row["chunk_id"],
            "episode_id": row["episode_id"],
            "podcast_id": row["podcast_id"],
            "podcast_name": row["podcast_name"] or row["podcast_id"],
            "episode_title": row["episode_title"],
            "start_formatted": row["start_formatted"],
            "text": row["text"],
            "source_site": row["source_site"],
            "opens": _as_int(row["opens"]),
            "last_opened": row["last_opened"].isoformat() if row["last_opened"] else None,
        }
        for row in clip_rows
    ]

    return {
        "timezone": TIMEZONE_NAME,
        "range": {
            "days": days,
            "from": start.isoformat(),
            "to": end.isoformat(),
        },
        "retention": {
            "query_days": query_retention_days,
            "aggregate_days": aggregate_retention_days,
        },
        "totals": {
            "searches": total_searches,
            "unique_searcher_days": total_unique,
            "avg_daily_unique_searchers": round(total_unique / days, 1),
            "avg_daily_searches": round(total_searches / days, 1),
            "zero_result_searches": total_zero,
            "zero_result_rate": (
                round(total_zero / total_searches, 4) if total_searches else 0.0
            ),
            "corrected_searches": total_corrected,
            "opens": total_opens,
        },
        "daily": daily,
        "top_queries": queries,
        "zero_result_queries": zero_queries,
        "podcasts": podcasts,
        "top_clips": clips,
        "review_candidates": review_candidates,
    }
