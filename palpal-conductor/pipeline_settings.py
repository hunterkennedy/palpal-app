"""
Pipeline auto-progression settings.

Settings are stored in the `settings` table and cached in memory.
The cache is invalidated whenever a value is written.
"""

import logging
from typing import Any

import db

logger = logging.getLogger(__name__)

KNOWN_KEYS = {"auto_discover", "auto_download", "auto_transcribe"}
KNOWN_INT_KEYS = {"min_episode_duration_seconds"}

_cache: dict[str, bool] | None = None


async def get_all() -> dict[str, Any]:
    global _cache
    if _cache is not None:
        result = dict(_cache)
    else:
        pool = db.get_pool()
        rows = await pool.fetch("SELECT key, value FROM settings WHERE key = ANY($1)", list(KNOWN_KEYS))
        _cache = {row["key"]: row["value"].lower() == "true" for row in rows}
        # Default to True for any key not yet in DB
        for key in KNOWN_KEYS:
            _cache.setdefault(key, True)
        result = dict(_cache)

    # Fetch int settings live (not worth caching separately)
    pool = db.get_pool()
    int_rows = await pool.fetch("SELECT key, value FROM settings WHERE key = ANY($1)", list(KNOWN_INT_KEYS))
    for row in int_rows:
        try:
            result[row["key"]] = int(row["value"])
        except (ValueError, TypeError):
            result[row["key"]] = 0
    for key in KNOWN_INT_KEYS:
        result.setdefault(key, 0)

    return result


async def get(key: str, default: bool = True) -> bool:
    settings = await get_all()
    return settings.get(key, default)


async def set(key: str, value: bool) -> None:
    global _cache
    if key not in KNOWN_KEYS:
        raise ValueError(f"Unknown setting: {key}")
    pool = db.get_pool()
    await pool.execute(
        "UPDATE settings SET value=$1, updated_at=NOW() WHERE key=$2",
        str(value).lower(), key,
    )
    if _cache is not None:
        _cache[key] = value
    logger.info("Pipeline setting %s = %s", key, value)


async def get_int(key: str, default: int = 0) -> int:
    if key not in KNOWN_INT_KEYS:
        raise ValueError(f"Unknown int setting: {key}")
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT value FROM settings WHERE key = $1", key)
    if row:
        try:
            return int(row["value"])
        except (ValueError, TypeError):
            return default
    return default


async def set_int(key: str, value: int) -> None:
    if key not in KNOWN_INT_KEYS:
        raise ValueError(f"Unknown int setting: {key}")
    pool = db.get_pool()
    await pool.execute(
        "UPDATE settings SET value=$1, updated_at=NOW() WHERE key=$2",
        str(value), key,
    )
    logger.info("Pipeline setting %s = %s", key, value)
