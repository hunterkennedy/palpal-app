"""
Tracks blurb worker liveness.

Job-claim polling backs off exponentially up to 12h when idle, so "last time
a job was claimed" is a poor connectivity signal — a perfectly healthy blurb
node can go hours without hitting /worker/jobs/next. Instead, blurb sends a
lightweight heartbeat on a short fixed interval (independent of job backoff),
and every worker-authenticated request touches the same row.

Heartbeats also carry the worker's current local state (polling / discovering /
downloading / transcribing / error), so the admin console can show what blurb
is doing right now rather than only "seen 20 seconds ago".
"""

import logging
from datetime import datetime, timezone

import db

logger = logging.getLogger(__name__)

# Comfortably above blurb's default 60s heartbeat interval to absorb network
# jitter without flapping, while still catching a dead node within ~2 minutes.
ONLINE_THRESHOLD_SECONDS = 150


async def record_heartbeat(worker_id: str | None) -> None:
    """Touch last_seen only. Used by every worker-authenticated request."""
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


async def record_state(
    worker_id: str | None,
    *,
    state: str | None = None,
    stage: str | None = None,
    job_id: str | None = None,
    detail: str | None = None,
    progress: dict | None = None,
    health: dict | None = None,
) -> None:
    """Full heartbeat: liveness plus what the worker is doing right now.

    blurb sends its complete state each time, so absent fields intentionally
    clear the previous value (e.g. state=polling, job_id=None once a job ends).
    """
    if not worker_id:
        return
    pool = db.get_pool()
    await pool.execute(
        """
        INSERT INTO worker_heartbeats
            (worker_id, last_seen_at, state, stage, job_id, detail, progress, health)
        VALUES ($1, now(), $2, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb),
                COALESCE($7::jsonb, '{}'::jsonb))
        ON CONFLICT (worker_id) DO UPDATE SET
            last_seen_at = now(),
            state        = $2,
            stage        = $3,
            job_id       = $4,
            detail       = $5,
            progress     = COALESCE($6::jsonb, '{}'::jsonb),
            health       = COALESCE($7::jsonb, '{}'::jsonb)
        """,
        worker_id,
        state,
        stage,
        job_id,
        (detail[:2000] if detail else None),
        progress,
        health,
    )


async def get_worker_status() -> dict:
    """Returns {connected, workers: [{..., online}]}, newest first."""
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT worker_id, last_seen_at, state, stage, job_id, detail, progress, health
        FROM worker_heartbeats
        ORDER BY last_seen_at DESC
        """
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
            "state": row["state"],
            "stage": row["stage"],
            "job_id": row["job_id"],
            "detail": row["detail"],
            "progress": row["progress"] or {},
            "health": row["health"] or {},
        })
    return {"connected": connected, "workers": workers}
