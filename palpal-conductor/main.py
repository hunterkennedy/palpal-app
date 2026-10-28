import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import asyncpg
import uvicorn
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse

import admin_events
import caches
import db
import pipeline_settings
import worker_status
from db_migrations import run_migrations
from auth import verify_admin_token, verify_worker_key
from models import (
    BulkActionRequest,
    ChunkResult,
    ChunksResponse,
    EpisodeExistsResponse,
    EpisodeInfo,
    PodcastResult,
    SearchResponse,
)
from pipeline import (
    run_discovery, wakeup_worker, cancel_process_job,
    start_scheduler, stop_scheduler, start_dispatch_worker, stop_dispatch_worker,
    get_scheduler_status, pause_processing, resume_processing, is_processing_paused,
    recover_interrupted_downloads,
    handle_discover_complete, handle_discover_fail,
    handle_process_complete, handle_process_fail,
    queue_episodes_for_processing, backfill_patreon_durations,
    cancel_jobs_for_source, cancel_jobs_for_podcast,
)
from activities.b2 import delete_transcript as b2_delete_transcript
from activities.process import process_transcript

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class _HealthFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /health" not in record.getMessage()


class _AdminLiveFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /admin/live" not in record.getMessage()


class _SearchFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /search" not in record.getMessage()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Attach after uvicorn has initialised its own logging
    _access_logger = logging.getLogger("uvicorn.access")
    _access_logger.addFilter(_HealthFilter())
    _access_logger.addFilter(_AdminLiveFilter())
    _access_logger.addFilter(_SearchFilter())
    # Ensure timestamps appear and formatting is consistent regardless of how uvicorn was invoked
    from uvicorn.logging import AccessFormatter, DefaultFormatter
    _access_fmt = "%(asctime)s %(levelprefix)s %(client_addr)s - \"%(request_line)s\" %(status_code)s"
    _default_fmt = "%(asctime)s %(levelprefix)s %(message)s"
    for _h in _access_logger.handlers:
        _h.setFormatter(AccessFormatter(_access_fmt))
    for _h in logging.getLogger().handlers:
        _h.setFormatter(DefaultFormatter(_default_fmt))

    await db.init_pool()
    logger.info("DB pool initialised")
    await run_migrations()
    await recover_interrupted_downloads()
    await start_scheduler()
    start_dispatch_worker()
    admin_events.start_listener()
    yield
    await admin_events.stop_listener()
    stop_dispatch_worker()
    stop_scheduler()
    await db.close_pool()
    logger.info("Shutdown complete")


app = FastAPI(title="palpal-conductor", lifespan=lifespan)


# --------------------------------------------------------------------------- #
# Worker endpoints (pull-based transcription)                                 #
# --------------------------------------------------------------------------- #

@app.get("/worker/jobs/next", tags=["worker"])
async def worker_next_job(
    _key: str = Depends(verify_worker_key),
    x_worker_id: str | None = Header(default=None),
):
    """Atomically claim the next pending job (discover or process). Returns 204 if none.

    If X-Worker-ID is supplied and that worker already has a claimed job, the job
    is reset to pending and immediately returned — transparently recovering from
    dropped connections without waiting for the scheduled reclaim.

    Falls back to a 10-minute time-based reclaim for workers without an ID.

    While processing is paused, 'process' jobs are skipped entirely — this is
    the one place that gate is actually enforced, so a pending process job
    (whether auto-dispatched, admin-queued, or left over from before the
    pause) truly cannot start, no matter how it got created. 'discover' jobs
    are unaffected: pausing stops the pipeline, not manual/scheduled discovery.
    """
    pool = db.get_pool()

    if x_worker_id:
        # If this worker already has a claimed job, something went wrong on its
        # last attempt. Reset it to pending so we can hand it straight back.
        await pool.execute(
            """
            UPDATE jobs
            SET status = 'pending', claimed_at = NULL, claimed_by_worker = NULL
            WHERE status = 'claimed' AND claimed_by_worker = $1
            """,
            x_worker_id,
        )
    else:
        # Fallback: time-based reclaim for workers that don't send an ID.
        await pool.execute(
            """
            UPDATE jobs
            SET status = 'pending', claimed_at = NULL, claimed_by_worker = NULL
            WHERE status = 'claimed'
              AND claimed_at < now() - interval '10 minutes'
            """
        )

    row = await pool.fetchrow(
        """
        UPDATE jobs
        SET status = 'claimed', claimed_at = now(), claimed_by_worker = $1
        WHERE id = (
            SELECT id FROM jobs
            WHERE status = 'pending'
              AND (kind != 'process' OR NOT $2)
            ORDER BY priority DESC, created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id::text, kind, payload
        """,
        x_worker_id, is_processing_paused(),
    )
    await worker_status.record_heartbeat(x_worker_id)

    if not row:
        return Response(status_code=204)

    worker_label = (x_worker_id or "unknown worker")[:8]
    await _add_job_event(
        pool, row["id"],
        f"Claimed by worker {worker_label}",
        stage="claimed",
    )
    return {"id": row["id"], "kind": row["kind"], "payload": row["payload"]}


@app.post("/worker/jobs/{job_id}/complete", tags=["worker"])
async def worker_complete(
    job_id: str, request: Request,
    _key: str = Depends(verify_worker_key),
    x_worker_id: str | None = Header(default=None),
):
    """
    Receive a job result from blurb and dispatch it to the kind-specific handler
    (discover → apply episodes/orphaning/icon; process → chunk + store transcript).

    We accept the raw request body and pass the JSON string directly to postgres
    to avoid blocking the event loop with json.loads on large transcripts, then
    parse it in a thread for the handler.
    """
    await worker_status.record_heartbeat(x_worker_id)
    raw_body = await request.body()
    result_json = raw_body.decode("utf-8")
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        UPDATE jobs
        SET status = 'completed', result = $1::text::jsonb
        WHERE id = $2::uuid AND status = 'claimed'
        RETURNING kind, payload
        """,
        result_json, job_id,
    )
    if not row:
        # Job was cancelled or reset (e.g. admin retry, or conductor restarted).
        # Return 200 so blurb doesn't retry — the result is stale and can be discarded.
        logger.warning(f"Stale complete for job {job_id} — job no longer claimed, discarding result")
        return {"status": "stale"}

    kind = row["kind"]
    payload = row["payload"]
    result = await asyncio.to_thread(json.loads, result_json)

    await _add_job_event(
        pool, job_id, f"{kind.title()} job completed", stage="completed",
    )

    if kind == "discover":
        await handle_discover_complete(job_id, payload, result)
    else:
        await handle_process_complete(job_id, payload, result)

    logger.info(f"Job {job_id} ({kind}) completed")
    return {"status": "accepted", "kind": kind}


@app.post("/worker/jobs/{job_id}/fail", tags=["worker"])
async def worker_fail(
    job_id: str, body: dict,
    _key: str = Depends(verify_worker_key),
    x_worker_id: str | None = Header(default=None),
):
    """Record a worker failure and dispatch it to the kind-specific handler."""
    await worker_status.record_heartbeat(x_worker_id)
    pool = db.get_pool()
    error = body.get("error", "unknown error")
    error_type = body.get("error_type")
    row = await pool.fetchrow(
        """
        UPDATE jobs
        SET status = 'failed', error = $1, error_type = $2
        WHERE id = $3::uuid AND status = 'claimed'
        RETURNING kind, payload
        """,
        error, error_type, job_id,
    )
    if not row:
        logger.warning(f"Stale fail for job {job_id} — job no longer claimed, ignoring")
        return {"status": "stale"}

    kind = row["kind"]
    payload = row["payload"]

    await _add_job_event(
        pool, job_id,
        error,
        level="error",
        stage="failed",
    )

    if kind == "discover":
        await handle_discover_fail(job_id, payload, error)
    else:
        await handle_process_fail(job_id, payload, error, error_type)

    logger.warning(f"Worker reported failure for job {job_id} ({kind}, {error_type}): {error}")
    return {"status": "failed", "kind": kind}


@app.post("/worker/jobs/{job_id}/progress", tags=["worker"])
async def worker_progress(
    job_id: str, body: dict,
    _key: str = Depends(verify_worker_key),
    x_worker_id: str | None = Header(default=None),
):
    """Live progress for a claimed job.

    blurb reports coarse stages ('downloading', 'transcribing', ...) plus an
    optional percentage and human-readable detail. Progress is stored on the
    job row so /admin/jobs and /admin/episodes can show what is actually
    happening, instead of treating every claimed job as an opaque blob.
    """
    stage = (body.get("stage") or "")[:80]
    detail = (body.get("detail") or "")[:500] or None
    percent = body.get("percent")
    try:
        percent = None if percent is None else max(0.0, min(100.0, float(percent)))
    except (TypeError, ValueError):
        percent = None

    progress = {"stage": stage or "working"}
    if percent is not None:
        progress["percent"] = round(percent, 1)
    if detail:
        progress["detail"] = detail

    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        UPDATE jobs
        SET progress = $1::jsonb, progress_at = now()
        WHERE id = $2::uuid AND status = 'claimed'
        RETURNING kind, episode_id::text
        """,
        json.dumps(progress), job_id,
    )
    if not row:
        return {"status": "stale"}
    await _record_progress_event(
        pool,
        job_id,
        progress["stage"],
        percent,
        detail or progress["stage"],
    )
    event_message = (body.get("event") or "")[:2000]
    if event_message:
        await _add_job_event(
            pool, job_id, event_message,
            stage=progress["stage"],
            percent=percent,
        )
    await worker_status.record_heartbeat(x_worker_id)
    return {"status": "ok", "kind": row["kind"]}


@app.post("/worker/heartbeat", tags=["worker"])
async def worker_heartbeat(
    body: dict | None = None,
    _key: str = Depends(verify_worker_key),
    x_worker_id: str | None = Header(default=None),
):
    """
    Lightweight liveness ping, independent of job polling. Job-claim polling
    backs off up to 12h when idle, so blurb calls this on a short fixed
    interval instead so the admin panel's connectivity indicator stays fresh.

    Newer blurb versions also include their local state, so the console can
    show the current stage instead of only a last-seen timestamp. Older
    workers that send no body keep working unchanged.
    """
    if body:
        await worker_status.record_state(
            x_worker_id,
            state=body.get("state"),
            stage=body.get("stage"),
            job_id=str(body["job_id"]) if body.get("job_id") else None,
            detail=body.get("detail"),
            progress=body.get("progress") if isinstance(body.get("progress"), dict) else None,
            health=body.get("health") if isinstance(body.get("health"), dict) else None,
        )
    else:
        await worker_status.record_heartbeat(x_worker_id)
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Admin endpoints                                                              #
# --------------------------------------------------------------------------- #


@app.get("/admin/pipeline-settings", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def get_pipeline_settings():
    """Get current pipeline auto-progression settings."""
    return await pipeline_settings.get_all()


@app.post("/admin/pipeline-settings", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def update_pipeline_settings(body: dict):
    """Update one or more pipeline settings. Pass {key: bool} pairs."""
    for key, value in body.items():
        if key in pipeline_settings.KNOWN_INT_KEYS:
            await pipeline_settings.set_int(key, int(value))
        elif key in pipeline_settings.KNOWN_STRING_KEYS:
            await pipeline_settings.set_string(key, str(value))
        else:
            await pipeline_settings.set(key, bool(value))
    return await pipeline_settings.get_all()


@app.post("/admin/discover", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def trigger_discovery(
    podcast_id: str | None = Query(None, description="Limit discovery to one podcast ID"),
    source_id: str | None = Query(None, description="Limit discovery to one source ID"),
    auto_queue: bool = Query(True, description="Automatically queue new episodes for processing"),
    dry_run: bool = Query(False, description="Scrape and summarise only; do not apply results"),
):
    """Manually trigger a discovery run (optionally scoped to one podcast or source)."""
    asyncio.create_task(
        run_discovery(
            podcast_id=podcast_id,
            auto_queue=auto_queue,
            source_id=source_id,
            dry_run=dry_run,
        )
    )
    return {
        "status": "started",
        "podcast_id": podcast_id,
        "source_id": source_id,
        "auto_queue": auto_queue,
        "dry_run": dry_run,
    }


@app.post("/admin/sources/{source_id}/test", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def test_source(source_id: str):
    """Queue a dry-run discovery job for one source and return its job id.

    The worker scrapes normally, but conductor summarises the result instead of
    applying inserts/blacklists/orphaning. The summary is stored on the job and
    shown in the admin job drawer.
    """
    result = await run_discovery(source_id=source_id, auto_queue=False, dry_run=True)
    if not result["job_ids"]:
        raise HTTPException(
            status_code=409,
            detail="That source is disabled, missing, or already has a discovery job in flight",
        )
    return {"status": "queued", "job_id": result["job_ids"][0], "source_id": source_id}


@app.post("/admin/episodes/backfill-patreon-duration", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def backfill_patreon_duration():
    """Queue a metadata-only duration probe for every Patreon episode missing
    duration_seconds (episodes discovered before duration capture existed).
    No re-download or re-transcribe — just fills in the one column."""
    n = await backfill_patreon_durations()
    return {"status": "queued", "jobs_created": n}


@app.get("/admin/scheduler/status", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def scheduler_status():
    """Current scheduler state and job next-run times."""
    return get_scheduler_status()


@app.post("/admin/scheduler/pause", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def scheduler_pause():
    """Pause processing — no 'process' job can be claimed by a worker while this
    is set, regardless of how it was created. Discovery (scheduled or manual)
    and the stuck-job reclaim sweep are unaffected."""
    await pause_processing()
    return {"status": "paused"}


@app.post("/admin/scheduler/resume", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def scheduler_resume():
    """Resume processing — also clears the auto-pause failure streak."""
    await resume_processing()
    return {"status": "running"}


# --------------------------------------------------------------------------- #
# Console: live stream + consolidated overview                                #
# --------------------------------------------------------------------------- #

@app.get("/admin/stream", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_stream():
    """Server-sent invalidation stream for the admin console.

    Sends an `invalidate` event (with the changed table names) whenever a
    watched table changes. The console debounces these and refetches only the
    queries it currently has open. A comment line every 15s keeps proxies from
    idling the connection out.
    """
    async def event_generator():
        queue = admin_events.subscribe()
        try:
            yield "retry: 3000\n\n"
            yield "event: ready\ndata: {}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"event: invalidate\ndata: {payload}\n\n"
        finally:
            admin_events.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


_ATTENTION_META = {
    "orphaned": {
        "label": "Missing from source",
        "description": "Previously discovered episodes that disappeared from the feed/channel.",
        "severity": "medium",
    },
    "rate_limited": {
        "label": "Rate limited",
        "description": "The source or downloader was throttled. Retrying later usually works.",
        "severity": "medium",
    },
    "age_restricted": {
        "label": "Age restricted",
        "description": "The source requires a logged-in/age-verified session.",
        "severity": "high",
    },
    "unavailable": {
        "label": "Private or unavailable",
        "description": "The episode is gone, private, or no longer fetchable.",
        "severity": "high",
    },
    "too_short": {
        "label": "Too short",
        "description": "Below the configured duration floor.",
        "severity": "low",
    },
    "network": {
        "label": "Network or timeout",
        "description": "Transient connectivity/DNS/timeout failures.",
        "severity": "medium",
    },
    "missing_title": {
        "label": "Missing metadata",
        "description": "The source listed the item without a usable title.",
        "severity": "medium",
    },
    "transcript": {
        "label": "Transcript or chunk failure",
        "description": "Download succeeded but transcript/chunk processing failed.",
        "severity": "high",
    },
    "other": {
        "label": "Other failures",
        "description": "Uncategorised failures that need a closer look.",
        "severity": "medium",
    },
}


def _attention_category(status: str, error: str | None) -> str:
    text = (error or "").lower()
    if status == "orphaned":
        return "orphaned"
    if "rate limit" in text or "429" in text or "too many requests" in text:
        return "rate_limited"
    if "age" in text and ("restrict" in text or "confirm" in text):
        return "age_restricted"
    if any(word in text for word in ("private", "unavailable", "removed", "not found", "404", "410")):
        return "unavailable"
    if "too short" in text or "shorter than" in text or "duration" in text:
        return "too_short"
    if any(word in text for word in ("timeout", "timed out", "connection", "network", "dns", "getaddrinfo")):
        return "network"
    if "title" in text:
        return "missing_title"
    if any(word in text for word in ("transcript", "chunk", "whisper", "ffmpeg")):
        return "transcript"
    return "other"


async def _get_ignored_attention(pool) -> set[str]:
    row = await pool.fetchrow("SELECT value FROM settings WHERE key = 'attention_ignored'")
    if not row:
        return set()
    try:
        value = json.loads(row["value"])
        return {str(v) for v in value} if isinstance(value, list) else set()
    except Exception:
        return set()


@app.get("/admin/attention", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_attention(include_ignored: bool = Query(False)):
    """Grouped failed/orphaned episodes for triage.

    Instead of one flat table, the console can reason about a whole failure
    class ("age restricted", "rate limited") and act on it at once. Ignored
    categories are an explicit setting so a known-benign failure class does not
    keep demanding attention.
    """
    pool = db.get_pool()
    ignored = await _get_ignored_attention(pool)
    rows = await pool.fetch(
        """
        SELECT e.id::text, e.title, e.status, e.error_message, e.updated_at,
               e.blacklisted, s.site, s.name AS source_name,
               p.id AS podcast_id, p.display_name AS podcast_name
        FROM episodes e
        JOIN sources  s ON s.id = e.source_id
        JOIN podcasts p ON p.id = s.podcast_id
        WHERE e.status IN ('failed', 'orphaned')
        ORDER BY e.updated_at DESC NULLS LAST
        LIMIT 2000
        """
    )

    grouped: dict[str, dict] = {}
    for row in rows:
        category = _attention_category(row["status"], row["error_message"])
        group = grouped.setdefault(category, {
            "key": category,
            "label": _ATTENTION_META[category]["label"],
            "description": _ATTENTION_META[category]["description"],
            "severity": _ATTENTION_META[category]["severity"],
            "ignored": category in ignored,
            "count": 0,
            "episode_ids": [],
            "episodes": [],
        })
        group["count"] += 1
        group["episode_ids"].append(row["id"])
        if len(group["episodes"]) < 12:
            group["episodes"].append({
                "id": row["id"],
                "title": row["title"],
                "status": row["status"],
                "error_message": row["error_message"],
                "site": row["site"],
                "podcast_id": row["podcast_id"],
                "podcast_name": row["podcast_name"],
                "source_name": row["source_name"],
                "updated_at": _iso(row["updated_at"]),
                "blacklisted": row["blacklisted"],
            })

    groups = sorted(
        grouped.values(),
        key=lambda g: (g["ignored"], -g["count"], g["label"]),
    )
    visible = [g for g in groups if include_ignored or not g["ignored"]]
    return {
        "groups": visible,
        "ignored_keys": sorted(ignored),
        "total": sum(g["count"] for g in visible),
        "total_all": sum(g["count"] for g in groups),
    }


@app.post("/admin/attention/ignore", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_attention_ignore(body: dict):
    """Ignore/restore an attention category globally."""
    category = str(body.get("category", "")).strip()
    if category not in _ATTENTION_META:
        raise HTTPException(status_code=400, detail="Unknown attention category")
    ignored = bool(body.get("ignored", True))
    pool = db.get_pool()
    current = await _get_ignored_attention(pool)
    if ignored:
        current.add(category)
    else:
        current.discard(category)
    await pool.execute(
        """
        INSERT INTO settings (key, value) VALUES ('attention_ignored', $1)
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        """,
        json.dumps(sorted(current)),
    )
    return {"status": "ok", "ignored": sorted(current)}


def _iso(value):
    return value.isoformat() if value is not None else None


_ACTIVE_JOB_SELECT = """
    SELECT j.id::text, j.kind, j.status, j.claimed_by_worker, j.claimed_at,
           j.created_at, j.priority, j.attempts, j.progress, j.progress_at,
           e.id::text AS episode_id, e.title AS episode_title,
           ep_pod.display_name AS episode_podcast,
           src.id::text AS source_id, src.name AS source_name,
           src_pod.display_name AS source_podcast
    FROM jobs j
    LEFT JOIN episodes e       ON e.id = j.episode_id
    LEFT JOIN sources  es      ON es.id = e.source_id
    LEFT JOIN podcasts ep_pod  ON ep_pod.id = es.podcast_id
    LEFT JOIN sources  src     ON src.id = j.source_id
    LEFT JOIN podcasts src_pod ON src_pod.id = src.podcast_id
"""


def _job_payload(row: dict) -> dict:
    d = dict(row)
    for key in ("claimed_at", "created_at", "finished_at", "progress_at"):
        if key in d:
            d[key] = _iso(d.get(key))
    d["progress"] = d.get("progress") or {}
    return d


async def _add_job_event(
    pool,
    job_id: str,
    message: str,
    *,
    level: str = "info",
    stage: str | None = None,
    percent: float | None = None,
) -> None:
    await pool.execute(
        """
        INSERT INTO job_events (job_id, level, stage, percent, message)
        VALUES ($1::uuid, $2, $3, $4, $5)
        """,
        job_id, level, stage, percent, message[:2000],
    )


async def _record_progress_event(
    pool,
    job_id: str,
    stage: str,
    percent: float | None,
    message: str,
) -> None:
    """Keep exactly one rolling progress row per (job, stage)."""
    await pool.execute(
        """
        INSERT INTO job_events (job_id, level, stage, percent, message)
        VALUES ($1::uuid, 'progress', $2, $3, $4)
        ON CONFLICT (job_id, stage) WHERE level = 'progress'
        DO UPDATE SET
            percent = EXCLUDED.percent,
            message = EXCLUDED.message,
            created_at = now()
        """,
        job_id, stage, percent, message[:2000],
    )


@app.get("/admin/overview", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_overview():
    """One consolidated snapshot for the console's landing page.

    The old panel assembled this from /admin/live, /admin/jobs and a 30s
    /admin/podcasts call, which meant three clocks and three sources of truth.
    This is one query batch on one clock.
    """
    pool = db.get_pool()

    async def _by_podcast():
        return await pool.fetch(
            """
            SELECT p.id, p.display_name, p.enabled, p.display_order,
                   COUNT(e.id) AS total,
                   COUNT(*) FILTER (WHERE e.status = 'discovered')  AS discovered,
                   COUNT(*) FILTER (WHERE e.status = 'downloading') AS downloading,
                   COUNT(*) FILTER (WHERE e.status = 'processed')   AS processed,
                   COUNT(*) FILTER (WHERE e.status = 'failed')      AS failed,
                   COUNT(*) FILTER (WHERE e.status = 'orphaned')    AS orphaned,
                   COUNT(*) FILTER (WHERE e.blacklisted)            AS blacklisted
            FROM podcasts p
            LEFT JOIN sources  s ON s.podcast_id = p.id
            LEFT JOIN episodes e ON e.source_id  = s.id
            GROUP BY p.id, p.display_name, p.enabled, p.display_order
            ORDER BY p.display_order, p.id
            """
        )

    async def _counts():
        return await pool.fetchrow(
            """
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'discovered')  AS discovered,
                   COUNT(*) FILTER (WHERE status = 'downloading') AS downloading,
                   COUNT(*) FILTER (WHERE status = 'processed')   AS processed,
                   COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
                   COUNT(*) FILTER (WHERE status = 'orphaned')    AS orphaned,
                   COUNT(*) FILTER (WHERE status = 'blacklisted') AS blacklisted,
                   COUNT(*) FILTER (WHERE blacklisted)            AS blacklisted_flag,
                   COUNT(*) FILTER (WHERE status IN ('failed', 'orphaned')) AS attention
            FROM episodes
            """
        )

    async def _job_counts():
        return await pool.fetch(
            """
            SELECT kind, status, COUNT(*) AS n FROM jobs
            WHERE status IN ('pending', 'claimed')
            GROUP BY kind, status
            """
        )

    async def _active_jobs():
        return await pool.fetch(
            f"""
            {_ACTIVE_JOB_SELECT}
            WHERE j.status IN ('pending', 'claimed')
            ORDER BY j.priority DESC, j.created_at
            LIMIT 12
            """
        )

    async def _recent_failures():
        return await pool.fetch(
            """
            SELECT j.id::text, j.kind, j.error, j.error_type, j.finished_at, j.created_at,
                   e.title AS episode_title, src.name AS source_name,
                   ep_pod.display_name AS episode_podcast,
                   src_pod.display_name AS source_podcast
            FROM jobs j
            LEFT JOIN episodes e       ON e.id = j.episode_id
            LEFT JOIN sources  es      ON es.id = e.source_id
            LEFT JOIN podcasts ep_pod  ON ep_pod.id = es.podcast_id
            LEFT JOIN sources  src     ON src.id = j.source_id
            LEFT JOIN podcasts src_pod ON src_pod.id = src.podcast_id
            WHERE j.status = 'failed'
            ORDER BY COALESCE(j.finished_at, j.created_at) DESC
            LIMIT 8
            """
        )

    async def _runs():
        return await pool.fetch(
            """
            SELECT key, value FROM settings
            WHERE key IN ('last_discovery_run', 'last_reclaim_run', 'processing_paused')
            """
        )

    async def _throughput():
        return await pool.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (
                    WHERE status = 'completed'
                      AND COALESCE(finished_at, created_at) > now() - interval '24 hours'
                ) AS completed_24h,
                COUNT(*) FILTER (
                    WHERE kind = 'process' AND status = 'completed'
                      AND COALESCE(finished_at, created_at) > now() - interval '7 days'
                ) AS process_completed_7d,
                AVG(EXTRACT(EPOCH FROM (finished_at - claimed_at))) FILTER (
                    WHERE kind = 'process' AND status = 'completed'
                      AND claimed_at IS NOT NULL AND finished_at IS NOT NULL
                      AND finished_at > now() - interval '7 days'
                ) AS avg_process_seconds,
                AVG(EXTRACT(EPOCH FROM (finished_at - claimed_at))) FILTER (
                    WHERE kind = 'discover' AND status = 'completed'
                      AND claimed_at IS NOT NULL AND finished_at IS NOT NULL
                      AND finished_at > now() - interval '7 days'
                ) AS avg_discover_seconds
            FROM jobs
            """
        )

    async def _throughput_by_site():
        return await pool.fetch(
            """
            SELECT COALESCE(payload->>'site', 'unknown') AS site,
                   COUNT(*) AS n,
                   AVG(EXTRACT(EPOCH FROM (finished_at - claimed_at))) AS avg_seconds
            FROM jobs
            WHERE kind = 'process' AND status = 'completed'
              AND claimed_at IS NOT NULL AND finished_at IS NOT NULL
              AND finished_at > now() - interval '7 days'
            GROUP BY 1
            ORDER BY 1
            """
        )

    (
        settings,
        pods,
        counts,
        job_counts,
        active_jobs,
        recent_failures,
        run_rows,
        blurb,
        throughput,
        throughput_sites,
    ) = await asyncio.gather(
        pipeline_settings.get_all(),
        _by_podcast(),
        _counts(),
        _job_counts(),
        _active_jobs(),
        _recent_failures(),
        _runs(),
        worker_status.get_worker_status(),
        _throughput(),
        _throughput_by_site(),
    )

    job_count_map = {f"{r['kind']}_{r['status']}": r["n"] for r in job_counts}
    runs = {r["key"]: r["value"] for r in run_rows}
    workers_online = sum(1 for w in blurb.get("workers", []) if w.get("online"))
    process_active = job_count_map.get("process_pending", 0) + job_count_map.get("process_claimed", 0)
    avg_process = float(throughput["avg_process_seconds"] or 0)
    queue_eta = (process_active * avg_process / max(1, workers_online)) if avg_process else None

    return {
        "scheduler": get_scheduler_status(),
        "blurb": blurb,
        "settings": settings,
        "counts": dict(counts),
        "podcasts": [dict(r) for r in pods],
        "jobs": {
            "counts": job_count_map,
            "active_total": sum(job_count_map.values()),
            "active": [_job_payload(r) for r in active_jobs],
            "recent_failures": [_job_payload(r) for r in recent_failures],
            "failed_24h": await pool.fetchval(
                "SELECT COUNT(*) FROM jobs WHERE status = 'failed' "
                "AND COALESCE(finished_at, created_at) > now() - interval '24 hours'"
            ),
        },
        "throughput": {
            "completed_24h": throughput["completed_24h"],
            "process_completed_7d": throughput["process_completed_7d"],
            "avg_process_seconds": avg_process or None,
            "avg_discover_seconds": (
                float(throughput["avg_discover_seconds"])
                if throughput["avg_discover_seconds"] is not None
                else None
            ),
            "jobs_per_hour": round((throughput["completed_24h"] or 0) / 24, 2),
            "workers_online": workers_online,
            "queue_eta_seconds": queue_eta,
            "by_site": [
                {
                    "site": r["site"],
                    "count": r["n"],
                    "avg_seconds": float(r["avg_seconds"]) if r["avg_seconds"] is not None else None,
                }
                for r in throughput_sites
            ],
        },
        "last_runs": {
            "discovery": runs.get("last_discovery_run"),
            "reclaim": runs.get("last_reclaim_run"),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/admin/episodes/{episode_id}/process", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def process_episode(episode_id: str):
    """Queue a discovered episode through the pipeline immediately — an explicit
    per-episode request, so it bypasses the auto_download toggle and scheduler
    pause state rather than silently no-op'ing when either is off."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status, title FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] != "discovered":
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only discovered episodes can be queued this way",
        )
    if not row["title"]:
        raise HTTPException(
            status_code=409,
            detail="Episode has no title — the source lists it as private/unfetchable, so it can never download",
        )
    queued = await queue_episodes_for_processing([episode_id])
    if not queued:
        raise HTTPException(status_code=409, detail="Episode already has an in-flight process job")
    return {"status": "queued", "episode_id": episode_id}


@app.get("/admin/live", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_live():
    """Lightweight real-time status for the admin panel: scheduler/processing
    state, blurb connectivity, per-podcast pipeline counts. Job-level detail
    (what's actually pending/claimed/failed right now) lives in /admin/jobs."""
    pool = db.get_pool()

    blurb, by_podcast_rows = await asyncio.gather(
        worker_status.get_worker_status(),
        pool.fetch(
            """
            SELECT s.podcast_id, p.display_name,
                   COUNT(*) FILTER (WHERE e.status = 'discovered')   AS discovered,
                   COUNT(*) FILTER (WHERE e.status = 'downloading')  AS downloading,
                   COUNT(*) FILTER (WHERE e.status = 'processed')    AS processed,
                   COUNT(*) FILTER (WHERE e.status = 'failed')       AS failed,
                   COUNT(*) FILTER (WHERE e.status = 'orphaned')     AS orphaned,
                   COUNT(*) FILTER (WHERE e.blacklisted)             AS blacklisted
            FROM episodes e
            JOIN sources s ON e.source_id = s.id
            JOIN podcasts p ON s.podcast_id = p.id
            GROUP BY s.podcast_id, p.display_name, p.display_order
            ORDER BY p.display_order
            """
        ),
    )

    return {
        "scheduler": get_scheduler_status(),
        "blurb": blurb,
        "by_podcast": [dict(r) for r in by_podcast_rows],
    }


@app.get("/admin/jobs", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    """The active job queue: pending/claimed jobs with target, progress,
    attempts and priority. History lives in /admin/jobs/history, which can be
    filtered and paged independently instead of only ever showing a 20-row tail.
    """
    pool = db.get_pool()
    offset = (page - 1) * page_size

    active_rows, counts_rows = await asyncio.gather(
        pool.fetch(
            f"""
            {_ACTIVE_JOB_SELECT}
            WHERE j.status IN ('pending', 'claimed')
            ORDER BY j.priority DESC, j.created_at
            LIMIT $1 OFFSET $2
            """,
            page_size, offset,
        ),
        pool.fetch(
            """
            SELECT kind, status, COUNT(*) AS n FROM jobs
            WHERE status IN ('pending', 'claimed')
            GROUP BY kind, status
            """
        ),
    )

    active_total = sum(r["n"] for r in counts_rows)

    return {
        "active": [_job_payload(r) for r in active_rows],
        "active_total": active_total,
        "page": page,
        "page_size": page_size,
        "counts": {f"{r['kind']}_{r['status']}": r["n"] for r in counts_rows},
    }


@app.get("/admin/jobs/history", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_job_history(
    status: str | None = Query(None, description="completed | failed | all"),
    kind: str | None = Query(None, description="discover | process"),
    q: str | None = Query(None, description="Match episode title, source name or error text"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    """Paged, filtered job history. Replaces the old fixed 20-row 'recent' tail."""
    pool = db.get_pool()
    offset = (page - 1) * page_size
    status_filter = None if status in (None, "all") else status
    kind_filter = None if kind in (None, "all") else kind

    where_sql = """
        WHERE j.status IN ('completed', 'failed')
          AND ($1::text IS NULL OR j.status = $1)
          AND ($2::text IS NULL OR j.kind = $2)
          AND ($3::text IS NULL OR
               COALESCE(e.title, '') ILIKE '%' || $3 || '%' OR
               COALESCE(src.name, '') ILIKE '%' || $3 || '%' OR
               COALESCE(j.error, '') ILIKE '%' || $3 || '%')
    """
    args = [status_filter, kind_filter, q]

    rows, total_row, counts_rows = await asyncio.gather(
        pool.fetch(
            f"""
            SELECT j.id::text, j.kind, j.status, j.error, j.error_type,
                   j.created_at, j.claimed_at, j.finished_at, j.attempts,
                   j.claimed_by_worker, j.progress,
                   e.id::text AS episode_id, e.title AS episode_title,
                   ep_pod.display_name AS episode_podcast,
                   src.id::text AS source_id, src.name AS source_name,
                   src_pod.display_name AS source_podcast
            FROM jobs j
            LEFT JOIN episodes e       ON e.id = j.episode_id
            LEFT JOIN sources  es      ON es.id = e.source_id
            LEFT JOIN podcasts ep_pod  ON ep_pod.id = es.podcast_id
            LEFT JOIN sources  src     ON src.id = j.source_id
            LEFT JOIN podcasts src_pod ON src_pod.id = src.podcast_id
            {where_sql}
            ORDER BY COALESCE(j.finished_at, j.created_at) DESC
            LIMIT $4 OFFSET $5
            """,
            *args, page_size, offset,
        ),
        pool.fetchrow(f"SELECT COUNT(*) FROM jobs j "
                      f"LEFT JOIN episodes e ON e.id = j.episode_id "
                      f"LEFT JOIN sources src ON src.id = j.source_id {where_sql}", *args),
        pool.fetch(
            """
            SELECT status, COUNT(*) AS n FROM jobs
            WHERE status IN ('completed', 'failed')
            GROUP BY status
            """
        ),
    )

    return {
        "jobs": [_job_payload(r) for r in rows],
        "total": total_row["count"],
        "page": page,
        "page_size": page_size,
        "counts": {r["status"]: r["n"] for r in counts_rows},
    }


@app.get("/admin/jobs/{job_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_job_detail(job_id: str):
    """Full details for one job, including payload and complete error text."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        SELECT j.id::text, j.kind, j.status, j.error, j.error_type,
               j.created_at, j.claimed_at, j.finished_at, j.attempts,
               j.priority, j.claimed_by_worker, j.progress, j.progress_at,
               j.payload, (j.result IS NOT NULL) AS has_result,
               CASE WHEN j.kind = 'discover'
                          AND COALESCE((j.payload->>'dry_run')::boolean, false)
                    THEN j.result ELSE NULL END AS dry_run_result,
               e.id::text AS episode_id, e.title AS episode_title,
               ep_pod.display_name AS episode_podcast,
               src.id::text AS source_id, src.name AS source_name,
               src_pod.display_name AS source_podcast
        FROM jobs j
        LEFT JOIN episodes e       ON e.id = j.episode_id
        LEFT JOIN sources  es      ON es.id = e.source_id
        LEFT JOIN podcasts ep_pod  ON ep_pod.id = es.podcast_id
        LEFT JOIN sources  src     ON src.id = j.source_id
        LEFT JOIN podcasts src_pod ON src_pod.id = src.podcast_id
        WHERE j.id = $1::uuid
        """,
        job_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    event_rows = await pool.fetch(
        """
        SELECT * FROM (
            SELECT id, created_at, level, stage, percent, message
            FROM job_events
            WHERE job_id = $1::uuid
            ORDER BY created_at DESC, id DESC
            LIMIT 120
        ) recent
        ORDER BY created_at ASC, id ASC
        """,
        job_id,
    )
    payload = _job_payload(row)
    payload["events"] = [
        {
            "id": e["id"],
            "created_at": _iso(e["created_at"]),
            "level": e["level"],
            "stage": e["stage"],
            "percent": float(e["percent"]) if e["percent"] is not None else None,
            "message": e["message"],
        }
        for e in event_rows
    ]
    return payload


@app.post("/admin/jobs/{job_id}/cancel", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_cancel_job(job_id: str):
    """Cancel a pending/claimed job and release its episode back to the queue.

    A claimed job may still be running on blurb; the stale-complete guard in
    /worker/jobs/{id}/complete discards whatever it posts back because the job
    is no longer 'claimed'. Duration-probe jobs are left alone on the episode
    side — they target already-processed rows.
    """
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        UPDATE jobs
        SET status = 'failed',
            error = 'Cancelled by admin',
            error_type = 'cancelled'
        WHERE id = $1::uuid AND status IN ('pending', 'claimed')
        RETURNING kind, episode_id::text, payload
        """,
        job_id,
    )
    if not row:
        raise HTTPException(status_code=409, detail="Job is not pending or claimed")

    await _add_job_event(
        pool, job_id, "Cancelled by admin", level="warning", stage="cancelled",
    )

    if row["kind"] == "process" and row["episode_id"] and not (row["payload"] or {}).get("duration_only"):
        await pool.execute(
            """
            UPDATE episodes
            SET status = 'discovered', error_message = 'Job cancelled by admin'
            WHERE id = $1::uuid AND status = 'downloading' AND blacklisted = FALSE
            """,
            row["episode_id"],
        )
    caches.bust_episodes_cache()
    return {"status": "cancelled", "job_id": job_id}


@app.post("/admin/jobs/{job_id}/prioritize", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_prioritize_job(job_id: str):
    """Move a pending job to the front of its queue."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE jobs SET priority = GREATEST(priority, 1) WHERE id = $1::uuid AND status = 'pending'",
        job_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=409, detail="Only pending jobs can be prioritized")
    await _add_job_event(pool, job_id, "Prioritized by admin", stage="prioritized")
    return {"status": "prioritized", "job_id": job_id}


@app.post("/admin/jobs/{job_id}/retry", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_retry_job(job_id: str):
    """Put a finished job back on the queue without losing its original payload."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        SELECT j.id, j.kind, j.status, j.episode_id::text, j.payload,
               e.blacklisted
        FROM jobs j
        LEFT JOIN episodes e ON e.id = j.episode_id
        WHERE j.id = $1::uuid
        """,
        job_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    if row["status"] not in ("completed", "failed"):
        raise HTTPException(status_code=409, detail="Only finished jobs can be retried")
    if row["blacklisted"]:
        raise HTTPException(
            status_code=409,
            detail="The episode is blacklisted — remove the blacklist before retrying",
        )

    try:
        await pool.execute(
            """
            UPDATE jobs
            SET status = 'pending', error = NULL, error_type = NULL,
                claimed_at = NULL, claimed_by_worker = NULL,
                progress = '{}'::jsonb, progress_at = NULL
            WHERE id = $1::uuid
            """,
            job_id,
        )
    except asyncpg.exceptions.UniqueViolationError:
        raise HTTPException(
            status_code=409,
            detail="The target already has an active job — wait for it to finish first",
        )

    if row["kind"] == "process" and row["episode_id"] and not (row["payload"] or {}).get("duration_only"):
        await pool.execute(
            """
            UPDATE episodes
            SET status = 'downloading', error_message = NULL
            WHERE id = $1::uuid AND blacklisted = FALSE
            """,
            row["episode_id"],
        )
    caches.bust_episodes_cache()
    wakeup_worker()
    await _add_job_event(pool, job_id, "Re-queued by admin", stage="retried")
    return {"status": "queued", "job_id": job_id}


@app.post("/admin/jobs/purge", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_purge_jobs(body: dict = Body(default={})):
    """Delete finished job history older than N days (default: everything)."""
    pool = db.get_pool()
    days = body.get("older_than_days")
    if days is None:
        result = await pool.execute("DELETE FROM jobs WHERE status IN ('completed', 'failed')")
    else:
        result = await pool.execute(
            "DELETE FROM jobs WHERE status IN ('completed', 'failed') "
            "AND COALESCE(finished_at, created_at) < now() - ($1::int * interval '1 day')",
            int(days),
        )
    deleted = int(result.split()[-1])
    return {"status": "purged", "deleted": deleted}


@app.post("/admin/episodes/{episode_id}/retry", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def retry_episode(episode_id: str):
    """Retry a failed or stuck episode from the beginning. Force-queues it directly
    rather than resuming the whole scheduler as a side effect — retrying one
    episode shouldn't silently undo a deliberate (or auto-triggered) pause."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status, title FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] not in ("failed", "downloading"):
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only failed or stuck episodes can be retried",
        )
    if not row["title"]:
        raise HTTPException(
            status_code=409,
            detail="Episode has no title — the source lists it as private/unfetchable, so it can never download. Delete or blacklist it instead.",
        )
    await cancel_process_job(episode_id, "Cancelled by admin retry")
    await pool.execute(
        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
        episode_id,
    )
    await queue_episodes_for_processing([episode_id])
    return {"status": "queued", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/delete", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def delete_episode(episode_id: str):
    """Hard-delete an episode and all associated data (transcript, chunks)."""
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT id FROM episodes WHERE id = $1::uuid", episode_id)
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    await cancel_process_job(episode_id, "Cancelled by admin delete")
    await b2_delete_transcript(episode_id)
    await pool.execute("DELETE FROM episodes WHERE id = $1::uuid", episode_id)
    caches.bust_episodes_cache()
    return {"status": "deleted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/blacklist", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def blacklist_episode(episode_id: str):
    """Mark an episode as blacklisted — kept in DB to prevent re-discovery, but
    skipped by automatic processing. Cancels any in-flight process job first —
    without this, a download/transcribe already underway keeps running and its
    eventual result flips status to 'processed' behind the blacklist's back.
    A 'downloading' episode has no job driving it anymore once cancelled, so
    it's moved to 'blacklisted' rather than left stuck; any other status is
    left as-is (e.g. an already-processed episode keeps its transcript)."""
    pool = db.get_pool()
    await cancel_process_job(episode_id, "Cancelled by admin blacklist")
    result = await pool.execute(
        """
        UPDATE episodes
        SET blacklisted = TRUE,
            status = CASE WHEN status = 'downloading' THEN 'blacklisted' ELSE status END
        WHERE id = $1::uuid
        """,
        episode_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    caches.bust_episodes_cache()
    return {"status": "blacklisted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/unblacklist", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def unblacklist_episode(episode_id: str):
    """Remove the blacklist flag from an episode. Auto-blacklisting (from the
    duration filter, or a 'too_short' processing outcome) also sets status to
    'blacklisted' directly — if we only cleared the flag here, the episode would
    be left with blacklisted=false but status='blacklisted' forever, a state no
    process/retry/retranscribe button matches. Reset status back to 'discovered'
    in that case so the episode re-enters the normal pipeline."""
    pool = db.get_pool()
    result = await pool.execute(
        """
        UPDATE episodes
        SET blacklisted   = FALSE,
            status        = CASE WHEN status = 'blacklisted' THEN 'discovered' ELSE status END,
            error_message = CASE WHEN status = 'blacklisted' THEN NULL ELSE error_message END
        WHERE id = $1::uuid
        """,
        episode_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    caches.bust_episodes_cache()
    wakeup_worker()
    return {"status": "unblacklisted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/retranscribe", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def retranscribe_episode(episode_id: str):
    """Delete existing transcript/chunks and re-run the full pipeline from download."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT id, status, title FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] == "downloading":
        raise HTTPException(
            status_code=409,
            detail="Episode is currently downloading — wait for it to complete before retranscribing",
        )
    if not row["title"]:
        raise HTTPException(
            status_code=409,
            detail="Episode has no title — the source lists it as private/unfetchable, so it can never download. Delete or blacklist it instead.",
        )
    await cancel_process_job(episode_id, "Cancelled by retranscribe")

    await pool.execute(
        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
    )
    await pool.execute("DELETE FROM transcript_chunks WHERE episode_id = $1::uuid", episode_id)
    caches.bust_episodes_cache()
    await queue_episodes_for_processing([episode_id])
    return {"status": "retranscribing", "episode_id": episode_id}


@app.post("/admin/episodes/rechunk", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def rechunk_all_episodes(
    podcast_id: str | None = Query(None),
    dry_run: bool = Query(False),
):
    """
    Re-chunk all processed episodes from stored raw segments using the current
    chunk_target_words setting. Runs in the background; returns episode count queued.
    Pass dry_run=true to count affected episodes without executing.
    """
    pool = db.get_pool()
    target_words = await pipeline_settings.get_int("chunk_target_words") or 50

    if podcast_id:
        rows = await pool.fetch(
            """SELECT e.id::text FROM episodes e
               JOIN sources s ON e.source_id = s.id
               WHERE e.status = 'processed' AND s.podcast_id = $1""",
            podcast_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT id::text FROM episodes WHERE status = 'processed'"
        )

    if dry_run:
        return {"queued": len(rows), "target_words": target_words, "dry_run": True}

    sem = asyncio.Semaphore(4)

    async def _rechunk(episode_id: str) -> None:
        async with sem:
            try:
                from activities.b2 import download_transcript as b2_download_transcript
                transcript = await b2_download_transcript(episode_id)
                if not transcript:
                    logger.warning("rechunk: no transcript in B2 for episode %s, skipping", episode_id)
                    return
                await process_transcript(episode_id, transcript, target_words=target_words)
            except Exception as exc:
                logger.error("rechunk failed for episode %s: %s", episode_id, exc)

    for row in rows:
        asyncio.create_task(_rechunk(row["id"]))

    return {"queued": len(rows), "target_words": target_words}


@app.post("/admin/episodes/process-discovered", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def process_all_discovered(podcast_id: str | None = Query(None)):
    """Queue discovered episodes through the pipeline immediately, optionally
    filtered by podcast. An explicit request, so bypasses auto_download/pause."""
    pool = db.get_pool()
    if podcast_id:
        rows = await pool.fetch(
            """SELECT e.id::text FROM episodes e
               JOIN sources s ON e.source_id = s.id
               WHERE e.status = 'discovered' AND e.blacklisted = FALSE AND s.podcast_id = $1""",
            podcast_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT id::text FROM episodes WHERE status = 'discovered' AND blacklisted = FALSE"
        )
    queued = await queue_episodes_for_processing([r["id"] for r in rows])
    return {"queued": queued}


_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


async def _resolve_episode_ids(
    pool, body: BulkActionRequest,
) -> list[str]:
    """Resolve a bulk target set from explicit ids or the active filter."""
    if body.all_matching and body.filter:
        f = body.filter
        args = _episode_filter_args(f.status, f.podcast_id, f.site, f.q)
        rows = await pool.fetch(
            f"""
            SELECT e.id::text
            FROM episodes e
            JOIN sources  s ON s.id = e.source_id
            JOIN podcasts p ON p.id = s.podcast_id
            {_episode_filter_sql()}
            LIMIT 5001
            """,
            *args,
        )
        if len(rows) > 5000:
            raise HTTPException(
                status_code=400,
                detail="That filter matches more than 5,000 episodes — narrow it first",
            )
        return [r["id"] for r in rows]

    seen: set[str] = set()
    ids: list[str] = []
    for raw in body.episode_ids:
        episode_id = str(raw)
        if episode_id in seen:
            continue
        seen.add(episode_id)
        ids.append(episode_id)
    return ids


@app.post("/admin/episodes/bulk-action", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bulk_episode_action(body: BulkActionRequest):
    """Apply an action to a set of episodes.

    Targets can be explicit ids or `all_matching` + the same filters as
    /admin/episodes (this is what powers "select all N matching" in the
    console). Actions are executed set-wise instead of one query per episode,
    so a 500-episode retry is a handful of statements, not 1,500.
    """
    if body.action not in ("retry", "process", "delete", "blacklist", "unblacklist", "retranscribe"):
        raise HTTPException(status_code=400, detail="invalid action")

    pool = db.get_pool()
    ids = await _resolve_episode_ids(pool, body)
    if not ids:
        return {"queued": 0, "total": 0, "results": []}

    valid_ids = [i for i in ids if _UUID_RE.match(i)]
    results: list[dict] = [
        {"id": i, "ok": False, "detail": "invalid episode id"} for i in ids if i not in valid_ids
    ]
    rows = await pool.fetch(
        "SELECT id::text, status, title, blacklisted FROM episodes WHERE id = ANY($1::uuid[])",
        valid_ids,
    )
    by_id = {r["id"]: r for r in rows}
    for episode_id in valid_ids:
        if episode_id not in by_id:
            results.append({"id": episode_id, "ok": False, "detail": "not found"})

    action = body.action
    found_ids = [i for i in valid_ids if i in by_id]

    if action in ("blacklist", "delete"):
        if found_ids:
            reason = "Cancelled by admin blacklist" if action == "blacklist" else "Cancelled by admin delete"
            await pool.execute(
                """
                UPDATE jobs SET status = 'failed', error = $2
                WHERE kind = 'process' AND status IN ('pending', 'claimed')
                  AND episode_id = ANY($1::uuid[])
                """,
                found_ids, reason,
            )

        if action == "blacklist":
            if found_ids:
                await pool.execute(
                    """
                    UPDATE episodes
                    SET blacklisted = TRUE,
                        status = CASE WHEN status = 'downloading' THEN 'blacklisted' ELSE status END
                    WHERE id = ANY($1::uuid[])
                    """,
                    found_ids,
                )
            results.extend({"id": i, "ok": True} for i in found_ids)
        else:
            sem = asyncio.Semaphore(8)
            ok_to_delete: list[str] = []

            async def _delete_blob(episode_id: str):
                async with sem:
                    try:
                        await b2_delete_transcript(episode_id)
                        return episode_id, None
                    except Exception as exc:
                        return episode_id, str(exc)

            delete_results = await asyncio.gather(*(_delete_blob(i) for i in found_ids))
            for episode_id, error in delete_results:
                if error:
                    results.append({"id": episode_id, "ok": False, "detail": f"transcript delete failed: {error}"})
                else:
                    ok_to_delete.append(episode_id)
            if ok_to_delete:
                await pool.execute(
                    "DELETE FROM episodes WHERE id = ANY($1::uuid[])", ok_to_delete
                )
            results.extend({"id": i, "ok": True} for i in ok_to_delete)

        caches.bust_episodes_cache()
        return {
            "queued": sum(1 for r in results if r["ok"]),
            "total": len(ids),
            "results": results,
        }

    if action == "unblacklist":
        if found_ids:
            await pool.execute(
                """
                UPDATE episodes
                SET blacklisted   = FALSE,
                    status        = CASE WHEN status = 'blacklisted' THEN 'discovered' ELSE status END,
                    error_message = CASE WHEN status = 'blacklisted' THEN NULL ELSE error_message END
                WHERE id = ANY($1::uuid[])
                """,
                found_ids,
            )
            wakeup_worker()
        results.extend({"id": i, "ok": True} for i in found_ids)
        caches.bust_episodes_cache()
        return {
            "queued": sum(1 for r in results if r["ok"]),
            "total": len(ids),
            "results": results,
        }

    # process / retry / retranscribe all end with a force-queued process job.
    eligible: list[str] = []
    for episode_id in found_ids:
        row = by_id[episode_id]
        if row["blacklisted"]:
            results.append({"id": episode_id, "ok": False, "detail": "blacklisted"})
            continue
        if not row["title"]:
            results.append({"id": episode_id, "ok": False, "detail": "no title — private/unfetchable, can never download"})
            continue
        if action == "process" and row["status"] != "discovered":
            results.append({"id": episode_id, "ok": False, "detail": f"cannot process '{row['status']}'"})
            continue
        if action == "retry" and row["status"] not in ("failed", "downloading"):
            results.append({"id": episode_id, "ok": False, "detail": f"cannot retry '{row['status']}'"})
            continue
        if action == "retranscribe" and row["status"] == "downloading":
            results.append({"id": episode_id, "ok": False, "detail": "episode is currently downloading"})
            continue
        eligible.append(episode_id)

    if eligible:
        if action in ("retry", "retranscribe"):
            await pool.execute(
                """
                UPDATE jobs SET status = 'failed', error = $2
                WHERE kind = 'process' AND status IN ('pending', 'claimed')
                  AND episode_id = ANY($1::uuid[])
                """,
                eligible,
                "Cancelled by admin retry" if action == "retry" else "Cancelled by retranscribe",
            )
            await pool.execute(
                "UPDATE episodes SET status = 'discovered', error_message = NULL WHERE id = ANY($1::uuid[])",
                eligible,
            )
        if action == "retranscribe":
            await pool.execute(
                "DELETE FROM transcript_chunks WHERE episode_id = ANY($1::uuid[])",
                eligible,
            )
        await queue_episodes_for_processing(eligible)
        results.extend({"id": i, "ok": True} for i in eligible)

    caches.bust_episodes_cache()
    return {
        "queued": len(eligible),
        "total": len(ids),
        "results": results,
    }


async def _fetch_episodes() -> list[EpisodeInfo]:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT
            e.id::text,
            e.video_id,
            e.title,
            e.publication_date,
            e.status,
            e.error_message,
            e.blacklisted,
            s.podcast_id,
            p.display_name  AS podcast_name,
            s.name          AS source_name,
            s.site,
            e.duration_seconds,
            e.created_at
        FROM episodes e
        JOIN sources  s  ON s.id  = e.source_id
        JOIN podcasts p  ON p.id  = s.podcast_id
        ORDER BY e.publication_date DESC NULLS LAST, e.created_at DESC
        """
    )
    return [
        EpisodeInfo(
            **{k: row[k] for k in row.keys()},
            youtube_url=f"https://youtube.com/watch?v={row['video_id']}",
        )
        for row in rows
    ]


@app.get("/episodes", tags=["episodes"], response_model=list[EpisodeInfo])
async def list_episodes() -> list[EpisodeInfo]:
    """All episodes with metadata and pipeline status. Cached for 5 minutes."""
    cached = caches.get_episodes()
    if cached is not None:
        return cached

    data = await _fetch_episodes()
    caches.set_episodes(data)
    return data


def _episode_filter_args(status, podcast_id, site, q):
    """Shared filter state for /admin/episodes and bulk-by-filter actions."""
    blacklisted_only = status == "blacklisted"
    attention = status == "attention"
    status_filter = None if status in (None, "all", "blacklisted", "attention") else status
    podcast_filter = None if podcast_id in (None, "all") else podcast_id
    site_filter = None if site in (None, "all") else site
    return [blacklisted_only, status_filter, podcast_filter, site_filter, q, attention]


def _episode_filter_sql() -> str:
    return """
        WHERE ($1::boolean IS NOT TRUE OR e.blacklisted = TRUE)
          AND ($2::text IS NULL OR e.status = $2)
          AND ($3::text IS NULL OR s.podcast_id = $3)
          AND ($4::text IS NULL OR s.site = $4)
          AND ($5::text IS NULL OR
               e.title        ILIKE '%' || $5 || '%' OR
               p.display_name ILIKE '%' || $5 || '%' OR
               s.name         ILIKE '%' || $5 || '%')
          AND ($6::boolean IS NOT TRUE OR e.status IN ('failed', 'orphaned'))
    """


_EPISODE_SORTS = {
    "newest": "e.publication_date DESC NULLS LAST, e.created_at DESC",
    "oldest": "e.publication_date ASC NULLS LAST, e.created_at ASC",
    "updated": "e.updated_at DESC NULLS LAST",
    "title": "e.title ASC",
    "status": "e.status ASC, e.publication_date DESC NULLS LAST",
    "duration": "e.duration_seconds DESC NULLS LAST",
}


@app.get("/admin/episodes", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_list_episodes(
    status: str | None = Query(
        None,
        description="Status value, 'attention' (failed + orphaned), "
                    "'blacklisted', or omit/'all' for no filter",
    ),
    podcast_id: str | None = Query(None),
    site: str | None = Query(None),
    q: str | None = Query(None, description="Case-insensitive title/podcast/source substring filter"),
    sort: str = Query("newest", description="newest | oldest | updated | title | status | duration"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Paginated, server-filtered episode list for the admin console.

    Each row carries its live process job (if any) including progress, so the
    table can distinguish "downloading 42%" from "transcribing" without a
    second request per row. Status-tab counts stay global, matching the tab UX.
    """
    pool = db.get_pool()
    offset = (page - 1) * page_size
    filter_args = _episode_filter_args(status, podcast_id, site, q)
    filter_sql = _episode_filter_sql()
    order_sql = _EPISODE_SORTS.get(sort, _EPISODE_SORTS["newest"])

    rows, total_row, counts_rows = await asyncio.gather(
        pool.fetch(
            f"""
            SELECT
                e.id::text, e.video_id, e.title, e.publication_date, e.status,
                e.error_message, e.blacklisted, s.podcast_id, p.display_name AS podcast_name,
                s.name AS source_name, s.site, e.duration_seconds,
                e.created_at, e.updated_at,
                aj.id::text AS active_job_id,
                aj.status AS active_job_status,
                aj.claimed_by_worker AS active_job_worker,
                aj.claimed_at AS active_job_claimed_at,
                aj.created_at AS active_job_created_at,
                aj.progress AS active_job_progress,
                aj.attempts AS active_job_attempts,
                aj.priority AS active_job_priority
            FROM episodes e
            JOIN sources  s ON s.id = e.source_id
            JOIN podcasts p ON p.id = s.podcast_id
            LEFT JOIN LATERAL (
                SELECT j.id, j.status, j.claimed_by_worker, j.claimed_at,
                       j.created_at, j.progress, j.attempts, j.priority
                FROM jobs j
                WHERE j.kind = 'process' AND j.episode_id = e.id
                  AND j.status IN ('pending', 'claimed')
                ORDER BY (j.status = 'claimed') DESC, j.created_at DESC
                LIMIT 1
            ) aj ON TRUE
            {filter_sql}
            ORDER BY {order_sql}
            LIMIT ${len(filter_args) + 1} OFFSET ${len(filter_args) + 2}
            """,
            *filter_args, page_size, offset,
        ),
        pool.fetchrow(
            f"""
            SELECT COUNT(*)
            FROM episodes e
            JOIN sources  s ON s.id = e.source_id
            JOIN podcasts p ON p.id = s.podcast_id
            {filter_sql}
            """,
            *filter_args,
        ),
        pool.fetch(
            "SELECT status, COUNT(*) AS n, COUNT(*) FILTER (WHERE blacklisted) AS bl "
            "FROM episodes GROUP BY status"
        ),
    )

    counts: dict[str, int] = {"all": 0, "blacklisted": 0, "attention": 0}
    for r in counts_rows:
        counts[r["status"]] = r["n"]
        counts["all"] += r["n"]
        counts["blacklisted"] += r["bl"]
        if r["status"] in ("failed", "orphaned"):
            counts["attention"] += r["n"]

    episodes = []
    for row in rows:
        episode = {
            k: row[k]
            for k in (
                "id", "video_id", "title", "publication_date", "status",
                "error_message", "blacklisted", "podcast_id", "podcast_name",
                "source_name", "site", "duration_seconds", "created_at", "updated_at",
            )
        }
        episode["youtube_url"] = f"https://youtube.com/watch?v={row['video_id']}"
        episode["active_job"] = (
            {
                "id": row["active_job_id"],
                "kind": "process",
                "status": row["active_job_status"],
                "claimed_by_worker": row["active_job_worker"],
                "claimed_at": _iso(row["active_job_claimed_at"]),
                "created_at": _iso(row["active_job_created_at"]),
                "progress": row["active_job_progress"] or {},
                "attempts": row["active_job_attempts"],
                "priority": row["active_job_priority"],
            }
            if row["active_job_id"]
            else None
        )
        episodes.append(episode)

    return {
        "episodes": episodes,
        "total": total_row["count"],
        "page": page,
        "page_size": page_size,
        "counts": counts,
    }


@app.get("/admin/episodes/{episode_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_episode_detail(episode_id: str):
    """Everything the console's episode drawer needs, in one request."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        SELECT e.id::text, e.video_id, e.title, e.publication_date, e.status,
               e.error_message, e.blacklisted, e.duration_seconds,
               e.created_at, e.updated_at,
               s.id::text AS source_id, s.name AS source_name, s.site,
               p.id AS podcast_id, p.display_name AS podcast_name,
               (SELECT COUNT(*) FROM transcript_chunks tc WHERE tc.episode_id = e.id) AS chunk_count,
               (SELECT COALESCE(SUM(tc.word_count), 0) FROM transcript_chunks tc WHERE tc.episode_id = e.id) AS word_count,
               (SELECT MIN(tc.start_time) FROM transcript_chunks tc WHERE tc.episode_id = e.id) AS first_chunk_at,
               (SELECT MAX(tc.end_time) FROM transcript_chunks tc WHERE tc.episode_id = e.id) AS last_chunk_at
        FROM episodes e
        JOIN sources  s ON s.id = e.source_id
        JOIN podcasts p ON p.id = s.podcast_id
        WHERE e.id = $1::uuid
        """,
        episode_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")

    jobs = await pool.fetch(
        """
        SELECT id::text, kind, status, error, error_type, attempts, priority,
               progress, progress_at, created_at, claimed_at, finished_at,
               claimed_by_worker
        FROM jobs
        WHERE episode_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 25
        """,
        episode_id,
    )

    chunk_meta = await pool.fetch(
        """
        SELECT chunk_index, start_time, end_time, word_count,
               LENGTH(text) AS chars
        FROM transcript_chunks
        WHERE episode_id = $1::uuid
        ORDER BY chunk_index
        """,
        episode_id,
    )
    chunk_preview = await pool.fetch(
        """
        SELECT chunk_index, start_time, end_time, word_count, text
        FROM transcript_chunks
        WHERE episode_id = $1::uuid
        ORDER BY chunk_index
        LIMIT 80
        """,
        episode_id,
    )

    empty_chunks = sum(1 for c in chunk_meta if (c["word_count"] or 0) <= 0 or (c["chars"] or 0) <= 0)
    max_gap = 0.0
    previous_end = None
    for chunk in chunk_meta:
        start = float(chunk["start_time"] or 0)
        end = float(chunk["end_time"] or 0)
        if previous_end is not None:
            max_gap = max(max_gap, max(0.0, start - previous_end))
        previous_end = end
    first_start = float(chunk_meta[0]["start_time"]) if chunk_meta else 0.0
    last_end = float(chunk_meta[-1]["end_time"]) if chunk_meta else 0.0
    expected_duration = float(row["duration_seconds"]) if row["duration_seconds"] else None
    short_transcript = bool(
        expected_duration
        and expected_duration > 60
        and last_end > 0
        and last_end < expected_duration * 0.65
    )

    index = {
        "chunk_count": len(chunk_meta),
        "word_count": sum(int(c["word_count"] or 0) for c in chunk_meta),
        "coverage_seconds": max(0.0, last_end - first_start),
        "first_chunk_at": first_start,
        "last_chunk_at": last_end,
        "max_gap_seconds": round(max_gap, 1),
        "empty_chunks": empty_chunks,
        "short_transcript": short_transcript,
        "expected_duration_seconds": expected_duration,
        "chunks": [
            {
                "chunk_index": c["chunk_index"],
                "start_time": float(c["start_time"] or 0),
                "end_time": float(c["end_time"] or 0),
                "word_count": int(c["word_count"] or 0),
                "text": c["text"],
            }
            for c in chunk_preview
        ],
    }

    episode = dict(row)
    episode["youtube_url"] = f"https://youtube.com/watch?v={row['video_id']}"
    return {"episode": episode, "jobs": [_job_payload(j) for j in jobs], "index": index}


@app.post("/admin/episodes/cache/bust", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bust_episodes_cache_endpoint() -> dict:
    """Force the next /episodes request to re-query the DB. Every admin action that
    changes an episode's status already does this automatically — this endpoint is
    a manual escape hatch, not something the admin panel needs to call itself."""
    caches.bust_episodes_cache()
    return {"status": "busted"}


@app.post("/admin/podcasts/cache/bust", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bust_podcasts_cache_endpoint() -> dict:
    """Force the next /podcasts request to re-query the DB. Every admin action that
    changes podcast/source config already does this automatically."""
    caches.bust_podcasts_cache()
    return {"status": "busted"}


@app.get("/admin/podcasts", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_list_podcasts():
    """All podcasts (including disabled) with source config and live stats.

    Stats are included here so the console can render the podcast page without
    joining a second aggregate endpoint that disagrees with /admin/overview.
    """
    pool = db.get_pool()
    pod_rows, src_rows = await asyncio.gather(
        pool.fetch(
            """
            SELECT p.id, p.display_name, p.enabled, p.display_order,
                   COUNT(DISTINCT s.id) AS source_count,
                   COUNT(e.id) AS total,
                   COUNT(*) FILTER (WHERE e.status = 'discovered')  AS discovered,
                   COUNT(*) FILTER (WHERE e.status = 'downloading') AS downloading,
                   COUNT(*) FILTER (WHERE e.status = 'processed')   AS processed,
                   COUNT(*) FILTER (WHERE e.status = 'failed')      AS failed,
                   COUNT(*) FILTER (WHERE e.status = 'orphaned')    AS orphaned,
                   COUNT(*) FILTER (WHERE e.blacklisted)            AS blacklisted
            FROM podcasts p
            LEFT JOIN sources  s ON s.podcast_id = p.id
            LEFT JOIN episodes e ON e.source_id  = s.id
            GROUP BY p.id, p.display_name, p.enabled, p.display_order
            ORDER BY p.display_order, p.id
            """
        ),
        pool.fetch(
            """
            SELECT s.id::text, s.podcast_id, s.name, s.site, s.url, s.enabled, s.filters,
                   COUNT(e.id) AS episode_count,
                   COUNT(*) FILTER (WHERE e.status = 'processed') AS processed,
                   COUNT(*) FILTER (WHERE e.status IN ('failed', 'orphaned')) AS problems,
                   lj.status AS last_discover_status,
                   lj.created_at AS last_discover_at,
                   lj.error AS last_discover_error
            FROM sources s
            LEFT JOIN episodes e ON e.source_id = s.id
            LEFT JOIN LATERAL (
                SELECT status, created_at, error
                FROM jobs
                WHERE kind = 'discover' AND source_id = s.id
                ORDER BY created_at DESC
                LIMIT 1
            ) lj ON TRUE
            GROUP BY s.id, s.podcast_id, s.name, s.site, s.url, s.enabled, s.filters,
                     lj.status, lj.created_at, lj.error
            ORDER BY s.name
            """
        ),
    )

    pods = {r["id"]: {**dict(r), "sources": []} for r in pod_rows}
    for s in src_rows:
        entry = dict(s)
        f = entry["filters"]
        entry["filters"] = f if isinstance(f, dict) else (json.loads(f) if isinstance(f, str) else {})
        entry["last_discover_at"] = _iso(entry.get("last_discover_at"))
        pid = entry.pop("podcast_id")
        if pid in pods:
            pods[pid]["sources"].append(entry)
    return list(pods.values())


@app.put("/admin/podcasts/order", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def reorder_podcasts(body: dict):
    """Persist a complete podcast order in one statement.

    The old panel issued one PUT per changed row after a drag; reordering ten
    podcasts meant ten round-trips and ten cache busts.
    """
    ids = body.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="ids must be a non-empty list")
    pool = db.get_pool()
    await pool.execute(
        """
        UPDATE podcasts p
        SET display_order = u.ord - 1
        FROM unnest($1::text[]) WITH ORDINALITY AS u(id, ord)
        WHERE p.id = u.id
        """,
        [str(i) for i in ids],
    )
    caches.bust_podcasts_cache()
    return {"status": "reordered", "count": len(ids)}


@app.post("/admin/podcasts", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def create_podcast(body: dict):
    """Create a new podcast."""
    pod_id = str(body.get("id", "")).strip()
    if not pod_id:
        raise HTTPException(status_code=400, detail="id is required")
    pool = db.get_pool()
    try:
        await pool.execute(
            "INSERT INTO podcasts (id, display_name, enabled, display_order) VALUES ($1, $2, $3, $4)",
            pod_id, body.get("display_name", pod_id),
            bool(body.get("enabled", True)), int(body.get("display_order", 0)),
        )
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Podcast ID already exists")
        raise
    caches.bust_podcasts_cache()
    return {"status": "created", "id": pod_id}


@app.put("/admin/podcasts/{podcast_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def update_podcast(podcast_id: str, body: dict):
    """Update podcast metadata."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE podcasts SET display_name=$1, enabled=$2, display_order=$3 WHERE id=$4",
        body.get("display_name", podcast_id),
        bool(body.get("enabled", True)), int(body.get("display_order", 0)), podcast_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Podcast not found")
    caches.bust_podcasts_cache()
    return {"status": "updated"}


@app.delete("/admin/podcasts/{podcast_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_delete_podcast(podcast_id: str):
    """Delete a podcast and all its sources and episodes (cascade). Cancels
    any live discover/process jobs underneath it first — see
    cancel_jobs_for_podcast for why a bare cascade delete isn't enough."""
    pool = db.get_pool()
    await cancel_jobs_for_podcast(podcast_id, "Cancelled: podcast deleted")
    result = await pool.execute("DELETE FROM podcasts WHERE id = $1", podcast_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Podcast not found")
    caches.bust_podcasts_cache()
    return {"status": "deleted"}



def _normalize_youtube_url(url: str) -> str:
    """
    If a YouTube URL contains a playlist param, return the canonical playlist URL.
    e.g. https://youtu.be/VIDEO?list=PL... → https://www.youtube.com/playlist?list=PL...
    """
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "list" in qs:
        playlist_id = qs["list"][0]
        return f"https://www.youtube.com/playlist?list={playlist_id}"
    return url


@app.post("/admin/podcasts/{podcast_id}/sources", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def create_source(podcast_id: str, body: dict):
    """Add a source to a podcast."""
    pool = db.get_pool()
    filters = body.get("filters", {})
    site = body.get("site", "youtube")
    url = _normalize_youtube_url(body.get("url", "")) if site == "youtube" else body.get("url", "")
    enabled = bool(body.get("enabled", True))
    row = await pool.fetchrow(
        "INSERT INTO sources (podcast_id, name, site, url, enabled, filters) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id::text",
        podcast_id, body.get("name", ""), site,
        url, enabled, json.dumps(filters),
    )
    caches.bust_podcasts_cache()
    return {"status": "created"}


@app.put("/admin/sources/{source_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def update_source(source_id: str, body: dict):
    """Update a source."""
    pool = db.get_pool()
    filters = body.get("filters", {})
    site = body.get("site", "youtube")
    url = _normalize_youtube_url(body.get("url", "")) if site == "youtube" else body.get("url", "")
    enabled = bool(body.get("enabled", True))
    row = await pool.fetchrow(
        "UPDATE sources SET name=$1, site=$2, url=$3, enabled=$4, filters=$5::jsonb WHERE id=$6::uuid RETURNING podcast_id",
        body.get("name", ""), site, url, enabled, json.dumps(filters), source_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Source not found")
    caches.bust_podcasts_cache()
    return {"status": "updated"}


@app.delete("/admin/sources/{source_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_delete_source(source_id: str):
    """Delete a source (cascades to its episodes). Cancels any live discover
    job for it and process jobs for its episodes first — see
    cancel_jobs_for_source for why a bare cascade delete isn't enough."""
    pool = db.get_pool()
    await cancel_jobs_for_source(source_id, "Cancelled: source deleted")
    result = await pool.execute("DELETE FROM sources WHERE id = $1::uuid", source_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Source not found")
    caches.bust_podcasts_cache()
    return {"status": "deleted"}


# --------------------------------------------------------------------------- #
# Search API                                                                   #
# --------------------------------------------------------------------------- #

async def correct_query(pool, q: str) -> str | None:
    """
    Attempt to correct misspelled words in q against the word_frequencies corpus.
    Returns a corrected query string, or None if no corrections were needed.
    Quoted phrases and operators are left untouched.
    """
    # Strip quoted phrases before extracting words to correct
    stripped = re.sub(r'"[^"]*"', '', q)
    words = list({w.lower() for w in re.findall(r'[a-zA-Z]{3,}', stripped)})
    if not words:
        return None

    corrections: dict[str, str] = {}
    for word in words:
        # Stem via the English FTS config so "marshmallows" → "marshmallow"
        # and we check the same representation that's stored in word_frequencies
        stem = await pool.fetchval(
            "SELECT lexeme FROM unnest(to_tsvector('english', $1)) LIMIT 1",
            word,
        )
        if not stem:
            continue
        if await pool.fetchval("SELECT 1 FROM word_frequencies WHERE word = $1", stem):
            continue  # word is in corpus, no correction needed
        # Find closest trigram match, prefer high-frequency words
        correction = await pool.fetchval(
            """
            SELECT word FROM word_frequencies
            WHERE similarity(word, $1) > 0.45
            ORDER BY similarity(word, $1) DESC, nentry DESC
            LIMIT 1
            """,
            stem,
        )
        if correction:
            corrections[word] = correction

    if not corrections:
        return None

    corrected = q
    for original, replacement in corrections.items():
        corrected = re.sub(
            rf'\b{re.escape(original)}\b', replacement, corrected, flags=re.IGNORECASE
        )
    return corrected if corrected.lower() != q.lower() else None


_ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"


@app.get("/search", tags=["search"], response_model=SearchResponse)
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=500, description="Full-text search query"),
    podcast_id: str | None = Query(None, description="Filter to a single podcast ID"),
    page: int = Query(1, ge=1, le=1000, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
    date_from: str | None = Query(None, pattern=_ISO_DATE, description="Only include episodes published on/after this date (YYYY-MM-DD)"),
    date_to: str | None = Query(None, pattern=_ISO_DATE, description="Only include episodes published on/before this date (YYYY-MM-DD)"),
) -> SearchResponse:
    client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")
    logger.info("search q=%r podcast_id=%r page=%d ip=%s", q, podcast_id, page, client_ip)
    # rank * freshness decay: 0.999^days_old (~30% decay after 1 year, ~50% after 2)
    # NULL publication_date gets no decay (treated as age 0)
    order_clause = (
        "ts_rank_cd(tc.search_vector, query, 1)"
        " * POWER(0.999, GREATEST(0, COALESCE(EXTRACT(DAYS FROM NOW() - tc.publication_date)::float, 0)))"
        " DESC"
    )

    pool = db.get_pool()
    offset = (page - 1) * page_size
    chunk_target_words = await pipeline_settings.get_int("chunk_target_words") or 50

    # Attempt spell-correction; if corrected query returns results use it instead
    corrected_query: str | None = await correct_query(pool, q)
    search_q = corrected_query if corrected_query else q

    main_q = f"""
        SELECT
            tc.id::text, tc.episode_id::text, tc.chunk_index, tc.text,
            tc.start_time, tc.end_time, tc.duration, tc.start_formatted,
            tc.start_minutes, tc.word_count, tc.podcast_id, tc.podcast_name,
            tc.source_name, tc.site, tc.episode_title, tc.video_id, tc.publication_date,
            ts_rank_cd(tc.search_vector, query, 1) AS rank,
            ts_headline('english', tc.text, query,
                'StartSel=<mark>, StopSel=</mark>, HighlightAll=true'
            ) AS text_highlighted,
            ts_headline('english', tc.episode_title, query,
                'StartSel=<mark>, StopSel=</mark>'
            ) AS title_highlighted
        FROM transcript_chunks tc,
             websearch_to_tsquery('english', $1) query
        WHERE tc.search_vector @@ query
          AND ($2::text IS NULL OR tc.podcast_id = $2)
          AND ($5::date IS NULL OR tc.publication_date >= $5::date)
          AND ($6::date IS NULL OR tc.publication_date <= $6::date)
        ORDER BY {order_clause}
        LIMIT $3 OFFSET $4
    """
    count_q = """
        SELECT COUNT(*)
        FROM transcript_chunks tc,
             websearch_to_tsquery('english', $1) query
        WHERE tc.search_vector @@ query
          AND ($2::text IS NULL OR tc.podcast_id = $2)
          AND ($3::date IS NULL OR tc.publication_date >= $3::date)
          AND ($4::date IS NULL OR tc.publication_date <= $4::date)
    """

    rows, total_row = await asyncio.gather(
        pool.fetch(main_q, search_q, podcast_id, page_size, offset, date_from, date_to),
        pool.fetchrow(count_q, search_q, podcast_id, date_from, date_to),
    )

    results = [ChunkResult(**dict(row)) for row in rows]
    return SearchResponse(
        total=total_row["count"],
        page=page,
        page_size=page_size,
        results=results,
        corrected_query=corrected_query,
    )


_CHUNK_FIELDS = (
    "id", "episode_id", "chunk_index", "text", "start_time", "end_time", "duration",
    "start_formatted", "start_minutes", "word_count", "podcast_id", "podcast_name",
    "source_name", "site", "episode_title", "video_id", "publication_date",
)


@app.get("/chunks", tags=["search"], response_model=ChunksResponse)
async def chunks(
    chunk_id: str = Query(..., description="UUID of the central chunk"),
    radius: int = Query(2, ge=0, le=10, description="Number of chunks on each side"),
) -> ChunksResponse:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        WITH center AS (
            SELECT episode_id, chunk_index FROM transcript_chunks WHERE id = $1::uuid
        ),
        bounds AS (
            SELECT MAX(tc2.chunk_index) AS max_index
            FROM transcript_chunks tc2, center
            WHERE tc2.episode_id = center.episode_id
        )
        SELECT tc.id::text, tc.episode_id::text, tc.chunk_index, tc.text,
               tc.start_time, tc.end_time, tc.duration, tc.start_formatted,
               tc.start_minutes, tc.word_count, tc.podcast_id, tc.podcast_name,
               tc.source_name, tc.site, tc.episode_title, tc.video_id, tc.publication_date,
               bounds.max_index
        FROM transcript_chunks tc, center, bounds
        WHERE tc.episode_id = center.episode_id
          AND tc.chunk_index BETWEEN center.chunk_index - $2 AND center.chunk_index + $2
        ORDER BY tc.chunk_index
        """,
        chunk_id, radius,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Chunk not found")

    has_more_before = rows[0]["chunk_index"] > 0
    has_more_after = rows[-1]["chunk_index"] < rows[0]["max_index"]
    results = [ChunkResult(**{k: row[k] for k in _CHUNK_FIELDS}) for row in rows]

    return ChunksResponse(chunks=results, has_more_before=has_more_before, has_more_after=has_more_after)


async def _fetch_podcasts() -> list[PodcastResult]:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT id, display_name, image,
               (icon IS NOT NULL) AS has_icon,
               social_sections, display_order
        FROM podcasts
        WHERE enabled = TRUE
        ORDER BY display_order
        """
    )
    results = []
    for row in rows:
        results.append(PodcastResult(**dict(row)))
    return results


@app.get("/podcasts", tags=["search"], response_model=list[PodcastResult])
async def podcasts() -> list[PodcastResult]:
    """Enabled podcasts with sources. Cached for 10 minutes."""
    cached = caches.get_podcasts()
    if cached is not None:
        return cached

    data = await _fetch_podcasts()
    caches.set_podcasts(data)
    return data


@app.get("/podcasts/{podcast_id}/image", tags=["search"])
async def get_podcast_image(podcast_id: str) -> Response:
    """Return the stored channel icon for a podcast."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT icon, icon_content_type FROM podcasts WHERE id = $1 AND enabled = TRUE",
        podcast_id,
    )
    if not row or not row["icon"]:
        raise HTTPException(status_code=404, detail="No icon available")
    # Icons come from remote sources (e.g. an RSS feed's artwork). Never serve
    # a scriptable type such as image/svg+xml from this origin.
    icon_type = (row["icon_content_type"] or "image/jpeg").split(";")[0].strip().lower()
    if icon_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        raise HTTPException(status_code=404, detail="Unsupported icon type")
    return Response(
        content=bytes(row["icon"]),
        media_type=icon_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/episodes/check", tags=["episodes"])
async def episodes_check(
    video_id: str = Query(..., description="YouTube video ID to look up"),
) -> EpisodeExistsResponse:
    """Returns true only if the episode has been fully processed (has transcript chunks)."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        SELECT 1 FROM transcript_chunks
        WHERE episode_id = (
            SELECT id FROM episodes WHERE video_id = $1 LIMIT 1
        )
        LIMIT 1
        """,
        video_id,
    )
    return EpisodeExistsResponse(exists=row is not None)


# --------------------------------------------------------------------------- #
_placeholders_cache: list[str] | None = None


@app.get("/search-placeholders", tags=["search"])
async def get_search_placeholders():
    """Rotating search bar placeholder texts."""
    global _placeholders_cache
    if _placeholders_cache is not None:
        return _placeholders_cache
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT value FROM settings WHERE key = 'search_placeholders'")
    _placeholders_cache = json.loads(row["value"]) if row else []
    return _placeholders_cache


@app.put("/admin/search-placeholders", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def set_search_placeholders(body: list[str] = Body(...)):
    """Replace the list of search bar placeholder texts."""
    global _placeholders_cache
    items = [str(s).strip() for s in body if str(s).strip()]
    pool = db.get_pool()
    await pool.execute(
        """INSERT INTO settings (key, value) VALUES ('search_placeholders', $1)
           ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()""",
        json.dumps(items),
    )
    _placeholders_cache = items
    return items


# Health                                                                       #
# --------------------------------------------------------------------------- #

@app.get("/whats-new", tags=["meta"])
async def whats_new():
    """All what's new entries, newest first."""
    pool = db.get_pool()
    rows = await pool.fetch(
        "SELECT id, content, posted_at FROM whats_new ORDER BY posted_at DESC"
    )
    return [{"id": r["id"], "content": r["content"], "posted_at": r["posted_at"].isoformat()} for r in rows]


@app.post("/admin/whats-new", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def create_whats_new(body: dict):
    """Create a new what's new entry. Body: {content: str}"""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")
    pool = db.get_pool()
    await pool.execute("INSERT INTO whats_new (content) VALUES ($1)", content)
    rows = await pool.fetch(
        "SELECT id, content, posted_at FROM whats_new ORDER BY posted_at DESC"
    )
    return [{"id": r["id"], "content": r["content"], "posted_at": r["posted_at"].isoformat()} for r in rows]


@app.delete("/admin/whats-new/{entry_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def delete_whats_new(entry_id: int):
    """Delete a what's new entry by ID."""
    pool = db.get_pool()
    result = await pool.execute("DELETE FROM whats_new WHERE id = $1", entry_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Entry not found")
    rows = await pool.fetch(
        "SELECT id, content, posted_at FROM whats_new ORDER BY posted_at DESC"
    )
    return [{"id": r["id"], "content": r["content"], "posted_at": r["posted_at"].isoformat()} for r in rows]


@app.get("/health", tags=["meta"])
async def health():
    try:
        await asyncio.wait_for(db.get_pool().fetchval("SELECT 1"), timeout=3.0)
    except Exception:
        raise HTTPException(status_code=503, detail="db unavailable")
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Entrypoint                                                                   #
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    import copy
    log_config = copy.deepcopy(uvicorn.config.LOGGING_CONFIG)
    log_config["formatters"]["access"]["fmt"] = "%(asctime)s %(levelprefix)s %(client_addr)s - \"%(request_line)s\" %(status_code)s"
    log_config["formatters"]["default"]["fmt"] = "%(asctime)s %(levelprefix)s %(message)s"
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info", log_config=log_config)
