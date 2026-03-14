import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import FileResponse, Response

import db
import pipeline_settings
from db_migrations import run_migrations
from auth import verify_blurb_token
from models import (
    BulkActionRequest,
    ChunkResult,
    EpisodeExistsResponse,
    EpisodeInfo,
    PodcastResult,
    SearchResponse,
    SourceInfo,
)
from pipeline import (
    run_discovery, run_episode, start_scheduler, stop_scheduler,
    get_scheduler_status, pause_scheduler, resume_scheduler,
    submit_downloaded_episode, recover_interrupted_downloads,
)

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
    yield
    stop_scheduler()
    await db.close_pool()
    logger.info("Shutdown complete")


app = FastAPI(title="palpal-conductor", lifespan=lifespan)


# --------------------------------------------------------------------------- #
# Admin endpoints                                                              #
# --------------------------------------------------------------------------- #

_ADMIN_HTML = Path(__file__).parent / "static" / "admin.html"


@app.get("/admin", tags=["admin"], include_in_schema=False)
async def admin_ui():
    """Serve the admin panel UI."""
    return FileResponse(_ADMIN_HTML, media_type="text/html")


@app.get("/admin/pipeline-settings", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def get_pipeline_settings():
    """Get current pipeline auto-progression settings."""
    return await pipeline_settings.get_all()


@app.post("/admin/pipeline-settings", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def update_pipeline_settings(body: dict):
    """Update one or more pipeline settings. Pass {key: bool} pairs."""
    for key, value in body.items():
        await pipeline_settings.set(key, bool(value))
    return await pipeline_settings.get_all()


@app.post("/admin/discover", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def trigger_discovery(
    podcast_id: str | None = Query(None, description="Limit discovery to one podcast ID"),
    auto_queue: bool = Query(True, description="Automatically queue new episodes for processing"),
):
    """Manually trigger a discovery run (optionally scoped to one podcast)."""
    asyncio.create_task(run_discovery(podcast_id=podcast_id, auto_queue=auto_queue))
    return {"status": "started", "podcast_id": podcast_id, "auto_queue": auto_queue}


@app.get("/admin/scheduler/status", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def scheduler_status():
    """Current scheduler state and job next-run times."""
    return get_scheduler_status()


@app.post("/admin/scheduler/pause", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def scheduler_pause():
    """Pause the APScheduler (stops automatic discovery and recovery jobs)."""
    pause_scheduler()
    return {"status": "paused"}


@app.post("/admin/scheduler/resume", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def scheduler_resume():
    """Resume the APScheduler."""
    resume_scheduler()
    return {"status": "running"}


@app.post("/admin/episodes/{episode_id}/process", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def process_episode(episode_id: str):
    """Queue a discovered or downloaded episode through the pipeline."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] not in ("discovered", "downloaded"):
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only discovered or downloaded episodes can be queued this way",
        )
    if row["status"] == "downloaded":
        asyncio.create_task(submit_downloaded_episode(episode_id))
    else:
        asyncio.create_task(run_episode(episode_id))
    return {"status": "queued", "episode_id": episode_id}


@app.get("/admin/status", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
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


@app.post("/admin/episodes/{episode_id}/retry", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def retry_episode(episode_id: str):
    """Retry a failed or stuck episode. Skips re-download if audio is already on disk."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status, audio_path FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] not in ("failed", "transcribing", "downloaded", "downloading"):
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only failed, stuck, or in-progress episodes can be retried",
        )

    if row["status"] == "transcribing":
        # Stuck in transcribing — reset to downloaded and resubmit
        await pool.execute(
            "UPDATE episodes SET status='downloaded', error_message=NULL WHERE id=$1::uuid",
            episode_id,
        )
        asyncio.create_task(submit_downloaded_episode(episode_id))
    elif row["audio_path"]:
        # Audio already on disk — skip re-download
        await pool.execute(
            "UPDATE episodes SET status='downloaded', error_message=NULL WHERE id=$1::uuid",
            episode_id,
        )
        asyncio.create_task(submit_downloaded_episode(episode_id))
    else:
        # No audio — full retry from the beginning
        await pool.execute(
            "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
            episode_id,
        )
        asyncio.create_task(run_episode(episode_id))

    return {"status": "queued", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/delete", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def delete_episode(episode_id: str):
    """Hard-delete an episode and all associated data (transcript, chunks). Removes audio file if present."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT id, audio_path FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    await pool.execute("DELETE FROM episodes WHERE id = $1::uuid", episode_id)
    if row["audio_path"] and os.path.exists(row["audio_path"]):
        try:
            os.remove(row["audio_path"])
        except OSError as e:
            logger.warning(f"Could not delete audio file {row['audio_path']}: {e}")
    return {"status": "deleted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/blacklist", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def blacklist_episode(episode_id: str):
    """Mark an episode as blacklisted — kept in DB to prevent re-discovery, but skipped by automatic processing."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE episodes SET blacklisted = TRUE WHERE id = $1::uuid", episode_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    return {"status": "blacklisted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/unblacklist", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def unblacklist_episode(episode_id: str):
    """Remove the blacklist flag from an episode."""
    pool = db.get_pool()
    result = await pool.execute(
        "UPDATE episodes SET blacklisted = FALSE WHERE id = $1::uuid", episode_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Episode not found")
    return {"status": "unblacklisted", "episode_id": episode_id}


@app.post("/admin/episodes/{episode_id}/retranscribe", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def retranscribe_episode(episode_id: str):
    """Delete existing transcript/chunks and re-run transcription. Uses cached audio if available."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status, audio_path FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")

    # Clear existing transcript data
    await pool.execute("DELETE FROM transcript_chunks WHERE episode_id = $1::uuid", episode_id)
    await pool.execute("DELETE FROM transcripts WHERE episode_id = $1::uuid", episode_id)

    if row["audio_path"] and os.path.exists(row["audio_path"]):
        await pool.execute(
            "UPDATE episodes SET status='downloaded', error_message=NULL WHERE id=$1::uuid", episode_id
        )
        asyncio.create_task(submit_downloaded_episode(episode_id))
    else:
        await pool.execute(
            "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
        )
        asyncio.create_task(run_episode(episode_id))

    return {"status": "retranscribing", "episode_id": episode_id}


@app.post("/admin/episodes/process-discovered", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
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
    for row in rows:
        asyncio.create_task(run_episode(row["id"]))
    return {"queued": len(rows)}


@app.post("/admin/episodes/bulk-action", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def bulk_episode_action(body: BulkActionRequest):
    """Apply an action to a list of episode IDs. Returns per-episode results."""
    if body.action not in ("retry", "process", "delete", "blacklist", "unblacklist", "retranscribe"):
        raise HTTPException(status_code=400, detail="invalid action")

    pool = db.get_pool()
    results = []

    for episode_id in body.episode_ids:
        try:
            row = await pool.fetchrow(
                "SELECT status, audio_path FROM episodes WHERE id = $1::uuid", episode_id
            )
            if not row:
                results.append({"id": episode_id, "ok": False, "detail": "not found"})
                continue

            if body.action == "retry":
                if row["status"] not in ("failed", "transcribing", "downloaded", "downloading"):
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot retry '{row['status']}'"})
                    continue
                if row["status"] == "transcribing":
                    await pool.execute(
                        "UPDATE episodes SET status='downloaded', error_message=NULL WHERE id=$1::uuid", episode_id
                    )
                    asyncio.create_task(submit_downloaded_episode(episode_id))
                elif row["audio_path"]:
                    await pool.execute(
                        "UPDATE episodes SET status='downloaded', error_message=NULL WHERE id=$1::uuid", episode_id
                    )
                    asyncio.create_task(submit_downloaded_episode(episode_id))
                else:
                    await pool.execute(
                        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
                    )
                    asyncio.create_task(run_episode(episode_id))

            elif body.action == "process":
                if row["status"] not in ("discovered", "downloaded"):
                    results.append({"id": episode_id, "ok": False, "detail": f"cannot process '{row['status']}'"})
                    continue
                if row["status"] == "downloaded":
                    asyncio.create_task(submit_downloaded_episode(episode_id))
                else:
                    asyncio.create_task(run_episode(episode_id))

            elif body.action == "delete":
                await pool.execute("DELETE FROM episodes WHERE id = $1::uuid", episode_id)
                if row.get("audio_path") and os.path.exists(row["audio_path"]):
                    try:
                        os.remove(row["audio_path"])
                    except OSError:
                        pass

            elif body.action == "blacklist":
                await pool.execute("UPDATE episodes SET blacklisted = TRUE WHERE id = $1::uuid", episode_id)

            elif body.action == "unblacklist":
                await pool.execute("UPDATE episodes SET blacklisted = FALSE WHERE id = $1::uuid", episode_id)

            elif body.action == "retranscribe":
                await pool.execute("DELETE FROM transcript_chunks WHERE episode_id = $1::uuid", episode_id)
                await pool.execute("DELETE FROM transcripts WHERE episode_id = $1::uuid", episode_id)
                if row.get("audio_path") and os.path.exists(row["audio_path"]):
                    await pool.execute(
                        "UPDATE episodes SET status='downloaded', error_message=NULL WHERE id=$1::uuid", episode_id
                    )
                    asyncio.create_task(submit_downloaded_episode(episode_id))
                else:
                    await pool.execute(
                        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid", episode_id
                    )
                    asyncio.create_task(run_episode(episode_id))

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
            COUNT(tc.id)       AS chunk_count,
            MAX(tc.end_time)   AS duration_seconds
        FROM episodes e
        JOIN sources  s  ON s.id  = e.source_id
        JOIN podcasts p  ON p.id  = s.podcast_id
        LEFT JOIN transcript_chunks tc ON tc.episode_id = e.id
        GROUP BY e.id, e.video_id, e.title, e.publication_date, e.status,
                 e.error_message, e.blacklisted, s.podcast_id, p.display_name, s.name
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


@app.get("/admin/episodes", tags=["admin"], response_model=list[EpisodeInfo], dependencies=[Depends(verify_blurb_token)])
async def admin_list_episodes() -> list[EpisodeInfo]:
    """All episodes — always live from DB, no cache. For admin panel use."""
    return await _fetch_episodes()


@app.post("/admin/episodes/cache/bust", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def bust_episodes_cache() -> dict:
    """Force the next /episodes request to re-query the DB."""
    _episodes_cache["data"] = None
    _episodes_cache["fetched_at"] = 0.0
    return {"status": "busted"}


@app.post("/admin/podcasts/cache/bust", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def bust_podcasts_cache() -> dict:
    """Force the next /podcasts request to re-query the DB."""
    _podcasts_cache["data"] = None
    _podcasts_cache["fetched_at"] = 0.0
    return {"status": "busted"}


# --------------------------------------------------------------------------- #
# Search API                                                                   #
# --------------------------------------------------------------------------- #

@app.get("/search", tags=["search"], response_model=SearchResponse)
async def search(
    q: str = Query(..., description="Full-text search query"),
    podcast_id: str | None = Query(None, description="Filter to a single podcast ID"),
    sort: str = Query("relevance", pattern="^(relevance|date|duration)$", description="Sort order"),
    date_from: date | None = Query(None, description="Filter: publication date from (inclusive)"),
    date_to: date | None = Query(None, description="Filter: publication date to (inclusive)"),
    page: int = Query(1, ge=1, le=1000, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
) -> SearchResponse:
    order_clause = {
        "relevance": "ts_rank(tc.search_vector, query) DESC",
        "date": "tc.publication_date DESC NULLS LAST",
        "duration": "tc.duration DESC",
    }[sort]

    pool = db.get_pool()
    offset = (page - 1) * page_size

    main_q = f"""
        SELECT
            tc.id::text, tc.episode_id::text, tc.chunk_index, tc.text,
            tc.start_time, tc.end_time, tc.duration, tc.start_formatted,
            tc.start_minutes, tc.word_count, tc.podcast_id, tc.podcast_name,
            tc.source_name, tc.episode_title, tc.video_id, tc.publication_date,
            ts_rank(tc.search_vector, query) AS rank,
            ts_headline('english', tc.text, query,
                'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15, MaxFragments=1'
            ) AS text_highlighted,
            ts_headline('english', tc.episode_title, query,
                'StartSel=<mark>, StopSel=</mark>'
            ) AS title_highlighted
        FROM transcript_chunks tc,
             websearch_to_tsquery('english', $1) query
        WHERE tc.search_vector @@ query
          AND ($2::text IS NULL OR tc.podcast_id = $2)
          AND ($3::date IS NULL OR tc.publication_date >= $3)
          AND ($4::date IS NULL OR tc.publication_date <= $4)
        ORDER BY {order_clause}
        LIMIT $5 OFFSET $6
    """
    count_q = """
        SELECT COUNT(*)
        FROM transcript_chunks tc,
             websearch_to_tsquery('english', $1) query
        WHERE tc.search_vector @@ query
          AND ($2::text IS NULL OR tc.podcast_id = $2)
          AND ($3::date IS NULL OR tc.publication_date >= $3)
          AND ($4::date IS NULL OR tc.publication_date <= $4)
    """

    rows, total_row = await asyncio.gather(
        pool.fetch(main_q, q, podcast_id, date_from, date_to, page_size, offset),
        pool.fetchrow(count_q, q, podcast_id, date_from, date_to),
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
    center = await pool.fetchrow(
        "SELECT episode_id, chunk_index FROM transcript_chunks WHERE id = $1::uuid",
        chunk_id,
    )
    if not center:
        raise HTTPException(status_code=404, detail="Chunk not found")
    chunk_low = center["chunk_index"] - radius
    chunk_high = center["chunk_index"] + radius
    rows = await pool.fetch(
        """
        SELECT id::text, episode_id::text, chunk_index, text, start_time, end_time,
               duration, start_formatted, start_minutes, word_count,
               podcast_id, podcast_name, source_name, episode_title, video_id, publication_date
        FROM transcript_chunks
        WHERE episode_id = $1
          AND chunk_index BETWEEN $2 AND $3
        ORDER BY chunk_index
        """,
        center["episode_id"], chunk_low, chunk_high,
    )
    return [ChunkResult(**dict(row)) for row in rows]


async def _fetch_podcasts() -> list[PodcastResult]:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT p.id, p.display_name, p.description, p.image,
               (p.icon IS NOT NULL) AS has_icon,
               p.social_sections, p.display_order,
               COALESCE(
                   json_agg(
                       json_build_object(
                           'id', s.id::text, 'name', s.name, 'site', s.site,
                           'type', s.type, 'description', s.description
                       ) ORDER BY s.name
                   ) FILTER (WHERE s.id IS NOT NULL),
                   '[]'::json
               ) AS sources
        FROM podcasts p
        LEFT JOIN sources s ON s.podcast_id = p.id AND s.enabled = TRUE
        WHERE p.enabled = TRUE
        GROUP BY p.id
        ORDER BY p.display_order
        """
    )
    results = []
    for row in rows:
        d = dict(row)
        if isinstance(d["sources"], str):
            d["sources"] = json.loads(d["sources"])
        results.append(PodcastResult(**d))
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

@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Entrypoint                                                                   #
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
