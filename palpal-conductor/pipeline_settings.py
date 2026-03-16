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
KNOWN_INT_KEYS = {"min_episode_duration_seconds", "chunk_target_words"}

_cache: dict[str, bool] | None = None
_int_cache: dict[str, int] | None = None


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

    for key in KNOWN_INT_KEYS:
        result[key] = await get_int(key, default=0)

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
        """INSERT INTO settings (key, value) VALUES ($2, $1)
           ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()""",
        str(value).lower(), key,
    )
    if _cache is not None:
        _cache[key] = value
    logger.info("Pipeline setting %s = %s", key, value)


async def get_int(key: str, default: int = 0) -> int:
    global _int_cache
    if key not in KNOWN_INT_KEYS:
        raise ValueError(f"Unknown int setting: {key}")
    if _int_cache is not None and key in _int_cache:
        return _int_cache[key]
    pool = db.get_pool()
    rows = await pool.fetch("SELECT key, value FROM settings WHERE key = ANY($1)", list(KNOWN_INT_KEYS))
    _int_cache = {}
    for row in rows:
        try:
            _int_cache[row["key"]] = int(row["value"])
        except (ValueError, TypeError):
            pass
    return _int_cache.get(key, default)


async def set_int(key: str, value: int) -> None:
    global _int_cache
    if key not in KNOWN_INT_KEYS:
        raise ValueError(f"Unknown int setting: {key}")
    pool = db.get_pool()
    await pool.execute(
        """INSERT INTO settings (key, value) VALUES ($2, $1)
           ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()""",
        str(value), key,
    )
    _int_cache = None
    logger.info("Pipeline setting %s = %s", key, value)
