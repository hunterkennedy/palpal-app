"""
Live change feed for the admin console.

Postgres statement-level triggers in migration 040 publish a NOTIFY on the
``palpal_admin`` channel for every table the console watches. A single
dedicated connection LISTENs for those notifications, coalesces bursts from a
bulk action, and fans out a tiny ``invalidate`` event to every connected SSE
client.

The event deliberately contains only table names, not rows: the console already
knows how to fetch exactly the page it is looking at, and row payloads would
mean re-implementing every query/authorisation rule in this module. The win over
the old 3-second polling loop is that work happens only when something actually
changed, and it arrives immediately.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger(__name__)

CHANNEL = "palpal_admin"
_DEBOUNCE_SECONDS = 0.15

_subscribers: set[asyncio.Queue] = set()
_listener_task: asyncio.Task | None = None
_pending_tables: set[str] = set()
_flush_handle: asyncio.TimerHandle | None = None


def subscribe() -> asyncio.Queue:
    """Register an SSE client. The caller must call unsubscribe() when done."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers.add(queue)
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    _subscribers.discard(queue)


def _flush() -> None:
    """Send one coalesced invalidation, then reset for the next burst."""
    global _flush_handle
    _flush_handle = None
    if not _pending_tables or not _subscribers:
        _pending_tables.clear()
        return

    payload = {
        "tables": sorted(_pending_tables),
        "at": datetime.now(timezone.utc).isoformat(),
    }
    _pending_tables.clear()
    encoded = json.dumps(payload)

    for queue in list(_subscribers):
        try:
            queue.put_nowait(encoded)
        except asyncio.QueueFull:
            # A client that has stopped reading must not block everyone else.
            # Drop its oldest pending event and keep the newest invalidation.
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                queue.put_nowait(encoded)
            except asyncio.QueueFull:
                pass


def _on_notify(conn, pid, channel, payload) -> None:
    """asyncpg LISTEN callback (runs on the event loop thread)."""
    global _flush_handle
    table = None
    try:
        table = json.loads(payload).get("table")
    except Exception:
        pass
    _pending_tables.add(table or "*")

    if _flush_handle is None:
        _flush_handle = asyncio.get_running_loop().call_later(
            _DEBOUNCE_SECONDS, _flush
        )


async def _listen_loop() -> None:
    """Own a dedicated LISTEN connection, reconnecting if it drops.

    Deliberately not taken from the query pool: a permanently-held pool slot
    would starve every other query if someone runs with DB_POOL_MAX=1.
    """
    while True:
        conn = None
        try:
            conn = await asyncpg.connect(dsn=os.environ["DATABASE_URL"])
            await conn.add_listener(CHANNEL, _on_notify)
            logger.info("Admin events: listening on %s", CHANNEL)

            while not conn.is_closed():
                await asyncio.sleep(5)

            logger.warning("Admin events: listener connection closed, reconnecting")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Admin events: listener error (%s), retrying in 3s", exc)
        finally:
            if conn is not None:
                try:
                    await conn.remove_listener(CHANNEL, _on_notify)
                except Exception:
                    pass
                try:
                    await conn.close()
                except Exception:
                    pass
        await asyncio.sleep(3)


def start_listener() -> None:
    global _listener_task
    if _listener_task is None or _listener_task.done():
        _listener_task = asyncio.create_task(_listen_loop(), name="admin-events")
        logger.info("Admin events: listener starting")


async def stop_listener() -> None:
    global _listener_task, _flush_handle
    if _flush_handle is not None:
        _flush_handle.cancel()
        _flush_handle = None
    if _listener_task is not None:
        _listener_task.cancel()
        try:
            await _listener_task
        except asyncio.CancelledError:
            pass
        _listener_task = None
    _subscribers.clear()
    _pending_tables.clear()
    logger.info("Admin events: listener stopped")
