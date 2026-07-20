"""
Tracks blurb worker liveness.

Job-claim polling backs off exponentially up to 12h when idle, so "last time
a job was claimed" is a poor connectivity signal — a perfectly healthy blurb
node can go hours without hitting /worker/jobs/next. Instead, blurb sends a
lightweight heartbeat on a short fixed interval (independent of job backoff),
and every worker-authenticated request touches the same row.
"""

import logging
from datetime import datetime, timezone

import db

logger = logging.getLogger(__name__)

# Comfortably above blurb's default 60s heartbeat interval to absorb network
# jitter without flapping, while still catching a dead node within ~2 minutes.
ONLINE_THRESHOLD_SECONDS = 150


async def record_heartbeat(worker_id: str | None) -> None:
    """No-op if no worker ID was supplied (e.g. an old/unidentified worker)."""
    if not worker_id:
        return
    pool = db.get_pool()
    await pool.execute(
        """
        INSERT INTO worker_heartbeats (worker_id, last_seen_at)
        VALUES ($1, now())
        ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now()
        """,
        worker_id,
    )


async def get_worker_status() -> dict:
    """Returns {connected, workers: [{worker_id, last_seen_at, online}]}, newest first."""
    pool = db.get_pool()
    rows = await pool.fetch(
        "SELECT worker_id, last_seen_at FROM worker_heartbeats ORDER BY last_seen_at DESC"
    )
    now = datetime.now(timezone.utc)
    workers = []
    connected = False
    for row in rows:
        age_seconds = (now - row["last_seen_at"]).total_seconds()
        online = age_seconds <= ONLINE_THRESHOLD_SECONDS
        connected = connected or online
        workers.append({
            "worker_id": row["worker_id"],
            "last_seen_at": row["last_seen_at"].isoformat(),
            "online": online,
        })
    return {"connected": connected, "workers": workers}
