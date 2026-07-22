import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

import uvicorn
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.responses import Response

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
    yield
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
            ORDER BY created_at
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

    if kind == "discover":
        await handle_discover_fail(job_id, payload, error)
    else:
        await handle_process_fail(job_id, payload, error, error_type)

    logger.warning(f"Worker reported failure for job {job_id} ({kind}, {error_type}): {error}")
    return {"status": "failed", "kind": kind}


@app.post("/worker/heartbeat", tags=["worker"])
async def worker_heartbeat(
    _key: str = Depends(verify_worker_key),
    x_worker_id: str | None = Header(default=None),
):
    """
    Lightweight liveness ping, independent of job polling. Job-claim polling
    backs off up to 12h when idle, so blurb calls this on a short fixed
    interval instead so the admin panel's connectivity indicator stays fresh.
    """
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
    auto_queue: bool = Query(True, description="Automatically queue new episodes for processing"),
):
    """Manually trigger a discovery run (optionally scoped to one podcast)."""
    asyncio.create_task(run_discovery(podcast_id=podcast_id, auto_queue=auto_queue))
    return {"status": "started", "podcast_id": podcast_id, "auto_queue": auto_queue}


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


def _fmt_job(row: dict) -> dict:
    d = dict(row)
    for key in ("claimed_at", "created_at"):
        if d.get(key) is not None:
            d[key] = d[key].isoformat()
    return d


@app.get("/admin/jobs", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    """The actual job queue: what's pending/claimed right now (with the target
    episode/source resolved via the real FK columns, not payload parsing),
    plus a short recent-history tail and per-kind/status counts. Replaces the
    old FSM tape, which only ever showed a single guessed-at active slot.

    The active list is paginated — with 100+ episodes backed up in the queue
    (e.g. processing paused for a while) this is polled every few seconds by
    the admin panel, so an unbounded SELECT here would mean shipping and
    re-rendering the whole queue on every poll.
    """
    pool = db.get_pool()
    offset = (page - 1) * page_size

    active_rows, recent_rows, counts_rows = await asyncio.gather(
        pool.fetch(
            """
            SELECT j.id::text, j.kind, j.status, j.claimed_by_worker, j.claimed_at, j.created_at,
                   e.title AS episode_title, ep_pod.display_name AS episode_podcast,
                   src.name AS source_name, src_pod.display_name AS source_podcast
            FROM jobs j
            LEFT JOIN episodes e       ON e.id = j.episode_id
            LEFT JOIN sources  es      ON es.id = e.source_id
            LEFT JOIN podcasts ep_pod  ON ep_pod.id = es.podcast_id
            LEFT JOIN sources  src     ON src.id = j.source_id
            LEFT JOIN podcasts src_pod ON src_pod.id = src.podcast_id
            WHERE j.status IN ('pending', 'claimed')
            ORDER BY j.created_at
            LIMIT $1 OFFSET $2
            """,
            page_size, offset,
        ),
        pool.fetch(
            """
            SELECT j.id::text, j.kind, j.status, j.error, j.error_type, j.created_at,
                   e.title AS episode_title, src.name AS source_name
            FROM jobs j
            LEFT JOIN episodes e ON e.id = j.episode_id
            LEFT JOIN sources  src ON src.id = j.source_id
            WHERE j.status IN ('completed', 'failed')
            ORDER BY j.created_at DESC
            LIMIT 20
            """
        ),
        pool.fetch(
            """
            SELECT kind, status, COUNT(*) AS n FROM jobs
            WHERE status IN ('pending', 'claimed')
            GROUP BY kind, status
            """
        ),
    )

    # counts_rows already aggregates every pending/claimed job regardless of
    # this call's page, so the active total comes from summing it rather than
    # a second COUNT(*) query.
    active_total = sum(r["n"] for r in counts_rows)

    return {
        "active": [_fmt_job(r) for r in active_rows],
        "active_total": active_total,
        "page": page,
        "page_size": page_size,
        "recent": [_fmt_job(r) for r in recent_rows],
        "counts": {f"{r['kind']}_{r['status']}": r["n"] for r in counts_rows},
    }


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


@app.post("/admin/episodes/bulk-action", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bulk_episode_action(body: BulkActionRequest):
    """Apply an action to a list of episode IDs. Returns per-episode results."""
    if body.action not in ("retry", "process", "delete", "blacklist", "unblacklist", "retranscribe"):
        raise HTTPException(status_code=400, detail="invalid action")

    pool = db.get_pool()
    results = []
    # Episodes that end this loop as 'discovered' via an explicit process/retry/
    # retranscribe request — force-queued together (bypassing auto_download and
    # scheduler-pause) once, after the loop, instead of per-item.
    to_queue: list[str] = []

    for episode_id in body.episode_ids:
        try:
            row = await pool.fetchrow(
                "SELECT status, title FROM episodes WHERE id = $1::uuid", episode_id
            )
            if not row:
                results.append({"id": episode_id, "ok": False, "detail": "not found"})
                continue

            if body.action == "retry":
                if row["status"] not in ("failed", "downloading"):
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot retry '{row['status']}'"})
                    continue
                if not row["title"]:
                    results.append({"id": episode_id, "ok": False, "detail": "no title — private/unfetchable, can never download"})
                    continue
                await cancel_process_job(episode_id, "Cancelled by admin retry")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
                )
                to_queue.append(episode_id)

            elif body.action == "process":
                if row["status"] != "discovered":
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot process '{row['status']}'"})
                    continue
                if not row["title"]:
                    results.append({"id": episode_id, "ok": False, "detail": "no title — private/unfetchable, can never download"})
                    continue
                to_queue.append(episode_id)

            elif body.action == "delete":
                await cancel_process_job(episode_id, "Cancelled by admin delete")
                await b2_delete_transcript(episode_id)
                await pool.execute("DELETE FROM episodes WHERE id = $1::uuid", episode_id)

            elif body.action == "blacklist":
                await cancel_process_job(episode_id, "Cancelled by admin blacklist")
                await pool.execute(
                    """
                    UPDATE episodes
                    SET blacklisted = TRUE,
                        status = CASE WHEN status = 'downloading' THEN 'blacklisted' ELSE status END
                    WHERE id = $1::uuid
                    """,
                    episode_id,
                )

            elif body.action == "unblacklist":
                await pool.execute(
                    """
                    UPDATE episodes
                    SET blacklisted   = FALSE,
                        status        = CASE WHEN status = 'blacklisted' THEN 'discovered' ELSE status END,
                        error_message = CASE WHEN status = 'blacklisted' THEN NULL ELSE error_message END
                    WHERE id = $1::uuid
                    """,
                    episode_id,
                )
                wakeup_worker()

            elif body.action == "retranscribe":
                if row["status"] == "downloading":
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot retranscribe '{row['status']}'"})
                    continue
                if not row["title"]:
                    results.append({"id": episode_id, "ok": False, "detail": "no title — private/unfetchable, can never download"})
                    continue
                await cancel_process_job(episode_id, "Cancelled by retranscribe")
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
                )
                await pool.execute("DELETE FROM transcript_chunks WHERE episode_id = $1::uuid", episode_id)
                to_queue.append(episode_id)

            results.append({"id": episode_id, "ok": True})

        except Exception as exc:
            results.append({"id": episode_id, "ok": False, "detail": str(exc)})

    if to_queue:
        await queue_episodes_for_processing(to_queue)

    queued = sum(1 for r in results if r["ok"])
    if queued:
        caches.bust_episodes_cache()
    return {"queued": queued, "total": len(body.episode_ids), "results": results}


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


@app.get("/admin/episodes", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_list_episodes(
    status: str | None = Query(None, description="Status value, or 'blacklisted' for the blacklisted flag, or omit/'all' for no filter"),
    podcast_id: str | None = Query(None),
    site: str | None = Query(None),
    q: str | None = Query(None, description="Case-insensitive title substring filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """
    Paginated, server-filtered episode list for the admin panel — always live
    from DB, no cache. Runs on the same fast poll as /admin/live and
    /admin/jobs (unlike those, this used to be a full unpaginated table dump
    on a slower poll, which is exactly why it visibly lagged behind them).

    Status-tab counts are global (independent of podcast_id/site/q, matching
    the existing tab UX) and returned separately in `counts` rather than
    computed from whatever page happens to be loaded.
    """
    pool = db.get_pool()
    offset = (page - 1) * page_size
    blacklisted_only = status == "blacklisted"
    status_filter = None if status in (None, "all", "blacklisted") else status
    podcast_filter = None if podcast_id in (None, "all") else podcast_id
    site_filter = None if site in (None, "all") else site

    filter_sql = """
        FROM episodes e
        JOIN sources  s ON s.id = e.source_id
        JOIN podcasts p ON p.id = s.podcast_id
        WHERE ($1::boolean IS NOT TRUE OR e.blacklisted = TRUE)
          AND ($2::text IS NULL OR e.status = $2)
          AND ($3::text IS NULL OR s.podcast_id = $3)
          AND ($4::text IS NULL OR s.site = $4)
          AND ($5::text IS NULL OR e.title ILIKE '%' || $5 || '%')
    """
    filter_args = [blacklisted_only, status_filter, podcast_filter, site_filter, q]

    rows, total_row, counts_rows = await asyncio.gather(
        pool.fetch(
            f"""
            SELECT
                e.id::text, e.video_id, e.title, e.publication_date, e.status,
                e.error_message, e.blacklisted, s.podcast_id, p.display_name AS podcast_name,
                s.name AS source_name, s.site, e.duration_seconds, e.created_at
            {filter_sql}
            ORDER BY e.publication_date DESC NULLS LAST, e.created_at DESC
            LIMIT ${len(filter_args) + 1} OFFSET ${len(filter_args) + 2}
            """,
            *filter_args, page_size, offset,
        ),
        pool.fetchrow(f"SELECT COUNT(*) {filter_sql}", *filter_args),
        pool.fetch(
            "SELECT status, COUNT(*) AS n, COUNT(*) FILTER (WHERE blacklisted) AS bl FROM episodes GROUP BY status"
        ),
    )

    counts: dict[str, int] = {"all": 0, "blacklisted": 0}
    for r in counts_rows:
        counts[r["status"]] = r["n"]
        counts["all"] += r["n"]
        counts["blacklisted"] += r["bl"]

    episodes = [
        EpisodeInfo(
            **{k: row[k] for k in row.keys()},
            youtube_url=f"https://youtube.com/watch?v={row['video_id']}",
        )
        for row in rows
    ]
    return {
        "episodes": episodes,
        "total": total_row["count"],
        "page": page,
        "page_size": page_size,
        "counts": counts,
    }


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
    """All podcasts (including disabled) with all sources and filter config."""
    pool = db.get_pool()
    pod_rows = await pool.fetch(
        "SELECT id, display_name, enabled, display_order FROM podcasts ORDER BY display_order, id"
    )
    src_rows = await pool.fetch(
        "SELECT id::text, podcast_id, name, site, url, enabled, filters FROM sources ORDER BY name"
    )
    pods = {r["id"]: {**dict(r), "sources": []} for r in pod_rows}
    for s in src_rows:
        entry = dict(s)
        f = entry["filters"]
        entry["filters"] = f if isinstance(f, dict) else (json.loads(f) if isinstance(f, str) else {})
        pid = entry.pop("podcast_id")
        if pid in pods:
            pods[pid]["sources"].append(entry)
    return list(pods.values())


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
    q: str = Query(..., description="Full-text search query"),
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
    return Response(
        content=bytes(row["icon"]),
        media_type=row["icon_content_type"] or "image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
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
