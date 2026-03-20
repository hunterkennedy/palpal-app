import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import FileResponse, Response

import db
import pipeline_settings
from db_migrations import run_migrations
from auth import verify_admin_token, verify_worker_key
from models import (
    BulkActionRequest,
    ChunkResult,
    EpisodeExistsResponse,
    EpisodeInfo,
    PodcastResult,
    SearchResponse,
)
from pipeline import (
    run_discovery, wakeup_worker, signal_job_complete,
    start_scheduler, stop_scheduler, start_download_worker, stop_download_worker,
    get_scheduler_status, pause_scheduler, resume_scheduler,
    recover_interrupted_downloads,
)
from activities.process import process_transcript

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    logger.info("DB pool initialised")
    await run_migrations()
    await recover_interrupted_downloads()
    start_scheduler()
    start_download_worker()
    yield
    stop_download_worker()
    stop_scheduler()
    await db.close_pool()
    logger.info("Shutdown complete")


app = FastAPI(title="palpal-conductor", lifespan=lifespan)


# --------------------------------------------------------------------------- #
# Worker endpoints (pull-based transcription)                                 #
# --------------------------------------------------------------------------- #

@app.get("/worker/jobs/next", tags=["worker"])
async def worker_next_job(_key: str = Depends(verify_worker_key)):
    """Atomically claim the next pending transcription job. Returns 204 if none."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        UPDATE transcription_jobs
        SET status = 'claimed', claimed_at = now()
        WHERE id = (
            SELECT id FROM transcription_jobs
            WHERE status = 'pending'
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id::text, episode_id::text, audio_path
        """
    )
    if not row:
        return Response(status_code=204)
    return dict(row)


@app.get("/worker/audio/{episode_id}", tags=["worker"])
async def worker_audio(episode_id: str, _key: str = Depends(verify_worker_key)):
    """Serve the audio file for a claimed transcription job."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT audio_path FROM transcription_jobs WHERE episode_id=$1::uuid AND status='claimed'",
        episode_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="No claimed job for this episode")
    path = row["audio_path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    return FileResponse(path, media_type="audio/mpeg")


@app.post("/worker/jobs/{job_id}/complete", tags=["worker"])
async def worker_complete(job_id: str, body: dict, _key: str = Depends(verify_worker_key)):
    """
    Receive a transcript from a worker and wake the waiting pipeline coroutine.
    Body: {language, segments} — same shape blurb returns.
    Processing (chunking, DB writes) happens inside episode_pipeline, not here.
    """
    pool = db.get_pool()
    row = await pool.fetchrow(
        """
        UPDATE transcription_jobs
        SET status = 'completed', result = $1::jsonb
        WHERE id = $2::uuid AND status = 'claimed'
        RETURNING episode_id::text
        """,
        json.dumps(body), job_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Job not found or not in claimed state")
    signal_job_complete(job_id)
    logger.info(f"Transcription result received for job {job_id}, episode {row['episode_id']}")
    return {"status": "accepted", "episode_id": row["episode_id"]}


@app.post("/worker/jobs/{job_id}/fail", tags=["worker"])
async def worker_fail(job_id: str, body: dict, _key: str = Depends(verify_worker_key)):
    """Record a worker failure and wake the waiting pipeline coroutine to handle it."""
    pool = db.get_pool()
    error = body.get("error", "unknown error")
    row = await pool.fetchrow(
        """
        UPDATE transcription_jobs
        SET status = 'failed', error = $1
        WHERE id = $2::uuid AND status = 'claimed'
        RETURNING episode_id::text
        """,
        error, job_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Job not found or not in claimed state")
    signal_job_complete(job_id)
    logger.warning(f"Worker reported failure for job {job_id} (episode {row['episode_id']}): {error}")
    return {"status": "failed", "episode_id": row["episode_id"]}


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


@app.get("/admin/scheduler/status", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def scheduler_status():
    """Current scheduler state and job next-run times."""
    return get_scheduler_status()


@app.post("/admin/scheduler/pause", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def scheduler_pause():
    """Pause the APScheduler (stops automatic discovery and recovery jobs)."""
    pause_scheduler()
    return {"status": "paused"}


@app.post("/admin/scheduler/resume", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def scheduler_resume():
    """Resume the APScheduler."""
    resume_scheduler()
    return {"status": "running"}


@app.post("/admin/episodes/{episode_id}/process", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def process_episode(episode_id: str):
    """Queue a discovered episode through the pipeline."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] != "discovered":
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only discovered episodes can be queued this way",
        )
    wakeup_worker()
    return {"status": "queued", "episode_id": episode_id}


@app.get("/admin/status", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_status():
    """Pipeline health dashboard — episode counts and recent failures."""
    pool = db.get_pool()

    counts_rows = await pool.fetch(
        "SELECT status, COUNT(*) AS n FROM episodes GROUP BY status ORDER BY status"
    )
    counts = {row["status"]: row["n"] for row in counts_rows}

    failures = await pool.fetch(
        """
        SELECT id::text, title, error_message, updated_at
        FROM episodes
        WHERE status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 20
        """
    )

    stuck = await pool.fetch(
        """
        SELECT id::text, title, updated_at
        FROM episodes
        WHERE status = 'transcribing'
          AND updated_at < now() - interval '2 hours'
        ORDER BY updated_at ASC
        """
    )

    return {
        "counts": counts,
        "recent_failures": [
            {
                "id": r["id"],
                "title": r["title"],
                "error_message": r["error_message"],
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in failures
        ],
        "stuck_transcribing": [
            {
                "id": r["id"],
                "title": r["title"],
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in stuck
        ],
    }


@app.post("/admin/episodes/{episode_id}/retry", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def retry_episode(episode_id: str):
    """Retry a failed or stuck episode from the beginning."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] not in ("failed", "transcribing", "downloading"):
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only failed or stuck episodes can be retried",
        )
    if row["status"] == "transcribing":
        await pool.execute(
            "UPDATE transcription_jobs SET status='failed', error='Cancelled by admin retry' "
            "WHERE episode_id=$1::uuid AND status IN ('pending','claimed')",
            episode_id,
        )
    await pool.execute(
        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
        episode_id,
    )
    wakeup_worker()
    return {"status": "queued", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/delete", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def delete_episode(episode_id: str):
    """Hard-delete an episode and all associated data (transcript, chunks)."""
    pool = db.get_pool()
    result = await pool.execute("DELETE FROM episodes WHERE id = $1::uuid", episode_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    return {"status": "deleted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/blacklist", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def blacklist_episode(episode_id: str):
    """Mark an episode as blacklisted — kept in DB to prevent re-discovery, but skipped by automatic processing."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE episodes SET blacklisted = TRUE WHERE id = $1::uuid", episode_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    return {"status": "blacklisted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/unblacklist", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def unblacklist_episode(episode_id: str):
    """Remove the blacklist flag from an episode."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE episodes SET blacklisted = FALSE WHERE id = $1::uuid", episode_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    return {"status": "unblacklisted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/retranscribe", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def retranscribe_episode(episode_id: str):
    """Delete existing transcript/chunks and re-run the full pipeline from download."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT id, status FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] == "downloading":
        raise HTTPException(
            status_code=409,
            detail="Episode is currently downloading — wait for it to complete before retranscribing",
        )
    if row["status"] == "transcribing":
        await pool.execute(
            "UPDATE transcription_jobs SET status='failed', error='Cancelled by retranscribe' "
            "WHERE episode_id=$1::uuid AND status IN ('pending','claimed')",
            episode_id,
        )

    await pool.execute("DELETE FROM transcript_chunks WHERE episode_id = $1::uuid", episode_id)
    await pool.execute("DELETE FROM transcripts WHERE episode_id = $1::uuid", episode_id)
    await pool.execute(
        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
    )
    wakeup_worker()
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
            row = await pool.fetchrow(
                "SELECT language, segments FROM transcripts WHERE episode_id = $1::uuid",
                episode_id,
            )
            if not row:
                return
            transcript = {"language": row["language"], "segments": row["segments"]}
            await process_transcript(episode_id, transcript, target_words=target_words)

    for row in rows:
        asyncio.create_task(_rechunk(row["id"]))

    return {"queued": len(rows), "target_words": target_words}


@app.get("/admin/status/by-podcast", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_status_by_podcast():
    """Per-podcast episode counts by status. Used to populate the pipeline table."""
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT s.podcast_id, p.display_name,
               COUNT(*) FILTER (WHERE e.status = 'discovered')   AS discovered,
               COUNT(*) FILTER (WHERE e.status = 'downloading')  AS downloading,
               COUNT(*) FILTER (WHERE e.status = 'transcribing') AS transcribing,
               COUNT(*) FILTER (WHERE e.status = 'processed')    AS processed,
               COUNT(*) FILTER (WHERE e.status = 'failed')       AS failed
        FROM episodes e
        JOIN sources s ON e.source_id = s.id
        JOIN podcasts p ON s.podcast_id = p.id
        GROUP BY s.podcast_id, p.display_name, p.display_order
        ORDER BY p.display_order
        """
    )
    return [dict(r) for r in rows]


@app.post("/admin/episodes/process-discovered", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def process_all_discovered(podcast_id: str | None = Query(None)):
    """Queue discovered episodes through the pipeline, optionally filtered by podcast."""
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
    if rows:
        wakeup_worker()
    return {"queued": len(rows)}


@app.post("/admin/episodes/process-downloaded", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def process_all_downloaded(podcast_id: str | None = Query(None)):
    """Kept for backwards compatibility — audio is now ephemeral, so this always returns 0."""
    return {"queued": 0}


@app.post("/admin/episodes/bulk-action", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bulk_episode_action(body: BulkActionRequest):
    """Apply an action to a list of episode IDs. Returns per-episode results."""
    if body.action not in ("retry", "process", "delete", "blacklist", "unblacklist", "retranscribe"):
        raise HTTPException(status_code=400, detail="invalid action")

    pool = db.get_pool()
    results = []

    for episode_id in body.episode_ids:
        try:
            row = await pool.fetchrow(
                "SELECT status FROM episodes WHERE id = $1::uuid", episode_id
            )
            if not row:
                results.append({"id": episode_id, "ok": False, "detail": "not found"})
                continue

            if body.action == "retry":
                if row["status"] not in ("failed", "transcribing", "downloading"):
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot retry '{row['status']}'"})
                    continue
                if row["status"] == "transcribing":
                    await pool.execute(
                        "UPDATE transcription_jobs SET status='failed', error='Cancelled by admin retry' "
                        "WHERE episode_id=$1::uuid AND status IN ('pending','claimed')",
                        episode_id,
                    )
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
                )
                wakeup_worker()

            elif body.action == "process":
                if row["status"] != "discovered":
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot process '{row['status']}'"})
                    continue
                wakeup_worker()

            elif body.action == "delete":
                await pool.execute("DELETE FROM episodes WHERE id = $1::uuid", episode_id)

            elif body.action == "blacklist":
                await pool.execute("UPDATE episodes SET blacklisted = TRUE WHERE id = $1::uuid", episode_id)

            elif body.action == "unblacklist":
                await pool.execute("UPDATE episodes SET blacklisted = FALSE WHERE id = $1::uuid", episode_id)

            elif body.action == "retranscribe":
                if row["status"] == "downloading":
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot retranscribe '{row['status']}'"})
                    continue
                if row["status"] == "transcribing":
                    await pool.execute(
                        "UPDATE transcription_jobs SET status='failed', error='Cancelled by retranscribe' "
                        "WHERE episode_id=$1::uuid AND status IN ('pending','claimed')",
                        episode_id,
                    )
                await pool.execute("DELETE FROM transcript_chunks WHERE episode_id = $1::uuid", episode_id)
                await pool.execute("DELETE FROM transcripts WHERE episode_id = $1::uuid", episode_id)
                await pool.execute(
                    "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
                )
                wakeup_worker()

            results.append({"id": episode_id, "ok": True})

        except Exception as exc:
            results.append({"id": episode_id, "ok": False, "detail": str(exc)})

    queued = sum(1 for r in results if r["ok"])
    return {"queued": queued, "total": len(body.episode_ids), "results": results}


# --------------------------------------------------------------------------- #
# Episodes list (cached)                                                       #
# --------------------------------------------------------------------------- #

_EPISODES_TTL = 300.0  # seconds
_episodes_cache: dict = {"data": None, "fetched_at": 0.0}

# --------------------------------------------------------------------------- #
# Podcasts list (cached)                                                       #
# --------------------------------------------------------------------------- #

_PODCASTS_TTL = 600.0  # seconds — podcast config changes rarely
_podcasts_cache: dict = {"data": None, "fetched_at": 0.0}


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
            COUNT(tc.id)       AS chunk_count,
            COALESCE(e.duration_seconds, MAX(tc.end_time)) AS duration_seconds,
            e.created_at
        FROM episodes e
        JOIN sources  s  ON s.id  = e.source_id
        JOIN podcasts p  ON p.id  = s.podcast_id
        LEFT JOIN transcript_chunks tc ON tc.episode_id = e.id
        GROUP BY e.id, e.video_id, e.title, e.publication_date, e.status,
                 e.error_message, e.blacklisted, s.podcast_id, p.display_name, s.name, s.site, e.created_at
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
    if (
        _episodes_cache["data"] is not None
        and time.monotonic() - _episodes_cache["fetched_at"] < _EPISODES_TTL
    ):
        return _episodes_cache["data"]

    data = await _fetch_episodes()
    _episodes_cache["data"] = data
    _episodes_cache["fetched_at"] = time.monotonic()
    return data


@app.get("/admin/episodes", tags=["admin"], response_model=list[EpisodeInfo], dependencies=[Depends(verify_admin_token)])
async def admin_list_episodes() -> list[EpisodeInfo]:
    """All episodes — always live from DB, no cache. For admin panel use."""
    return await _fetch_episodes()


@app.post("/admin/episodes/cache/bust", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bust_episodes_cache() -> dict:
    """Force the next /episodes request to re-query the DB."""
    _episodes_cache["data"] = None
    _episodes_cache["fetched_at"] = 0.0
    return {"status": "busted"}


@app.post("/admin/podcasts/cache/bust", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def bust_podcasts_cache() -> dict:
    """Force the next /podcasts request to re-query the DB."""
    _podcasts_cache["data"] = None
    _podcasts_cache["fetched_at"] = 0.0
    return {"status": "busted"}


def _bust_caches():
    _podcasts_cache["data"] = None
    _podcasts_cache["fetched_at"] = 0.0


@app.get("/admin/podcasts", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_list_podcasts():
    """All podcasts (including disabled) with all sources and filter config."""
    pool = db.get_pool()
    pod_rows = await pool.fetch(
        "SELECT id, display_name, description, enabled, display_order FROM podcasts ORDER BY display_order, id"
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
            "INSERT INTO podcasts (id, display_name, description, enabled, display_order) VALUES ($1, $2, $3, $4, $5)",
            pod_id, body.get("display_name", pod_id), body.get("description", ""),
            bool(body.get("enabled", True)), int(body.get("display_order", 0)),
        )
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Podcast ID already exists")
        raise
    _bust_caches()
    return {"status": "created", "id": pod_id}


@app.put("/admin/podcasts/{podcast_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def update_podcast(podcast_id: str, body: dict):
    """Update podcast metadata."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE podcasts SET display_name=$1, description=$2, enabled=$3, display_order=$4 WHERE id=$5",
        body.get("display_name", podcast_id), body.get("description", ""),
        bool(body.get("enabled", True)), int(body.get("display_order", 0)), podcast_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Podcast not found")
    _bust_caches()
    return {"status": "updated"}


@app.delete("/admin/podcasts/{podcast_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_delete_podcast(podcast_id: str):
    """Delete a podcast and all its sources and episodes (cascade)."""
    pool = db.get_pool()
    result = await pool.execute("DELETE FROM podcasts WHERE id = $1", podcast_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Podcast not found")
    _bust_caches()
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
    url = _normalize_youtube_url(body.get("url", ""))
    enabled = bool(body.get("enabled", True))
    row = await pool.fetchrow(
        "INSERT INTO sources (podcast_id, name, site, url, enabled, filters) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id::text",
        podcast_id, body.get("name", ""), body.get("site", "youtube"),
        url, enabled, json.dumps(filters),
    )
    _bust_caches()
    return {"status": "created"}


@app.put("/admin/sources/{source_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def update_source(source_id: str, body: dict):
    """Update a source."""
    pool = db.get_pool()
    filters = body.get("filters", {})
    url = _normalize_youtube_url(body.get("url", ""))
    enabled = bool(body.get("enabled", True))
    site = body.get("site", "youtube")
    row = await pool.fetchrow(
        "UPDATE sources SET name=$1, site=$2, url=$3, enabled=$4, filters=$5::jsonb WHERE id=$6::uuid RETURNING podcast_id",
        body.get("name", ""), site, url, enabled, json.dumps(filters), source_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Source not found")
    _bust_caches()
    return {"status": "updated"}


@app.delete("/admin/sources/{source_id}", tags=["admin"], dependencies=[Depends(verify_admin_token)])
async def admin_delete_source(source_id: str):
    """Delete a source (cascades to its episodes)."""
    pool = db.get_pool()
    result = await pool.execute("DELETE FROM sources WHERE id = $1::uuid", source_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Source not found")
    _bust_caches()
    return {"status": "deleted"}


# --------------------------------------------------------------------------- #
# Search API                                                                   #
# --------------------------------------------------------------------------- #

@app.get("/search", tags=["search"], response_model=SearchResponse)
async def search(
    q: str = Query(..., description="Full-text search query"),
    podcast_id: str | None = Query(None, description="Filter to a single podcast ID"),
    page: int = Query(1, ge=1, le=1000, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
) -> SearchResponse:
    order_clause = "ts_rank(tc.search_vector, query) DESC"

    pool = db.get_pool()
    offset = (page - 1) * page_size
    chunk_target_words = await pipeline_settings.get_int("chunk_target_words") or 50

    main_q = f"""
        SELECT
            tc.id::text, tc.episode_id::text, tc.chunk_index, tc.text,
            tc.start_time, tc.end_time, tc.duration, tc.start_formatted,
            tc.start_minutes, tc.word_count, tc.podcast_id, tc.podcast_name,
            tc.source_name, tc.episode_title, tc.video_id, tc.publication_date,
            ts_rank(tc.search_vector, query) AS rank,
            ts_headline('english', tc.text, query,
                'StartSel=<mark>, StopSel=</mark>, MaxWords={chunk_target_words}, MinWords={chunk_target_words // 2}, MaxFragments=1'
            ) AS text_highlighted,
            ts_headline('english', tc.episode_title, query,
                'StartSel=<mark>, StopSel=</mark>'
            ) AS title_highlighted
        FROM transcript_chunks tc,
             websearch_to_tsquery('english', $1) query
        WHERE tc.search_vector @@ query
          AND ($2::text IS NULL OR tc.podcast_id = $2)
        ORDER BY {order_clause}
        LIMIT $3 OFFSET $4
    """
    count_q = """
        SELECT COUNT(*)
        FROM transcript_chunks tc,
             websearch_to_tsquery('english', $1) query
        WHERE tc.search_vector @@ query
          AND ($2::text IS NULL OR tc.podcast_id = $2)
    """

    rows, total_row = await asyncio.gather(
        pool.fetch(main_q, q, podcast_id, page_size, offset),
        pool.fetchrow(count_q, q, podcast_id),
    )

    results = [ChunkResult(**dict(row)) for row in rows]
    return SearchResponse(
        total=total_row["count"],
        page=page,
        page_size=page_size,
        results=results,
    )


@app.get("/chunks", tags=["search"], response_model=list[ChunkResult])
async def chunks(
    chunk_id: str = Query(..., description="UUID of the central chunk"),
    radius: int = Query(2, ge=0, le=10, description="Number of chunks on each side"),
) -> list[ChunkResult]:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        WITH center AS (
            SELECT episode_id, chunk_index FROM transcript_chunks WHERE id = $1::uuid
        )
        SELECT tc.id::text, tc.episode_id::text, tc.chunk_index, tc.text,
               tc.start_time, tc.end_time, tc.duration, tc.start_formatted,
               tc.start_minutes, tc.word_count, tc.podcast_id, tc.podcast_name,
               tc.source_name, tc.episode_title, tc.video_id, tc.publication_date
        FROM transcript_chunks tc, center
        WHERE tc.episode_id = center.episode_id
          AND tc.chunk_index BETWEEN center.chunk_index - $2 AND center.chunk_index + $2
        ORDER BY tc.chunk_index
        """,
        chunk_id, radius,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return [ChunkResult(**dict(row)) for row in rows]


async def _fetch_podcasts() -> list[PodcastResult]:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT id, display_name, description, image,
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
    if (
        _podcasts_cache["data"] is not None
        and time.monotonic() - _podcasts_cache["fetched_at"] < _PODCASTS_TTL
    ):
        return _podcasts_cache["data"]

    data = await _fetch_podcasts()
    _podcasts_cache["data"] = data
    _podcasts_cache["fetched_at"] = time.monotonic()
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
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Entrypoint                                                                   #
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
