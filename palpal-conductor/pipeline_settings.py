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

_cache: dict[str, bool] | None = None


async def get_all() -> dict[str, bool]:
    global _cache
    if _cache is not None:
        return dict(_cache)
    pool = db.get_pool()
    rows = await pool.fetch("SELECT key, value FROM settings WHERE key = ANY($1)", list(KNOWN_KEYS))
    _cache = {row["key"]: row["value"].lower() == "true" for row in rows}
    # Default to True for any key not yet in DB
    for key in KNOWN_KEYS:
        _cache.setdefault(key, True)
    return dict(_cache)


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
