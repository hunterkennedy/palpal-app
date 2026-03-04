import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import date

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, status

import db
from auth import verify_blurb_token
from models import (
    BlurbWebhookPayload,
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
    start_scheduler()
    yield
    stop_scheduler()
    await db.close_pool()
    logger.info("Shutdown complete")


app = FastAPI(title="palpal-conductor", lifespan=lifespan)


# --------------------------------------------------------------------------- #
# Blurb webhook (authenticated)                                                #
# --------------------------------------------------------------------------- #

@app.post("/blurb/webhook/{job_id}", tags=["blurb"], dependencies=[Depends(verify_blurb_token)])
async def blurb_webhook(job_id: str, payload: BlurbWebhookPayload):
    """Called by blurb when transcription is complete."""
    logger.info(f"Received transcript webhook for job {job_id}")

    pool = db.get_pool()

    if payload.status != "completed" or not payload.result:
        logger.error(f"Blurb failure for {job_id}: {payload.error}")
        await pool.execute(
            "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
            f"Blurb reported failure: {payload.error}", job_id,
        )
        return {"status": "noted"}

    try:
        await process_transcript(job_id, payload.result)
        await pool.execute(
            "UPDATE episodes SET status='processed' WHERE id=$1::uuid", job_id
        )
    except Exception as exc:
        logger.error(f"process_transcript failed for {job_id}: {exc}")
        await pool.execute(
            "UPDATE episodes SET status='failed', error_message=$1 WHERE id=$2::uuid",
            f"process_transcript: {exc}", job_id,
        )

    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Admin endpoints                                                              #
# --------------------------------------------------------------------------- #

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
    """Queue a discovered episode through the pipeline without resetting its status."""
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
    """Reset a failed episode to 'discovered' and re-queue it through the pipeline."""
    pool = db.get_pool()
    row = await pool.fetchrow(
        "SELECT status FROM episodes WHERE id = $1::uuid", episode_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not found")
    if row["status"] not in ("failed", "transcribing"):
        raise HTTPException(
            status_code=409,
            detail=f"Episode is '{row['status']}' — only failed or stuck transcribing episodes can be retried",
        )

    await pool.execute(
        "UPDATE episodes SET status='discovered', error_message=NULL WHERE id=$1::uuid",
        episode_id,
    )
    asyncio.create_task(run_episode(episode_id))
    return {"status": "queued", "episode_id": episode_id}


# --------------------------------------------------------------------------- #
# Episodes list (cached)                                                       #
# --------------------------------------------------------------------------- #

_EPISODES_TTL = 300.0  # seconds
_episodes_cache: dict = {"data": None, "fetched_at": 0.0}


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
            s.podcast_id,
            p.display_name  AS podcast_name,
            s.name          AS source_name,
            COUNT(tc.id)    AS chunk_count
        FROM episodes e
        JOIN sources  s  ON s.id  = e.source_id
        JOIN podcasts p  ON p.id  = s.podcast_id
        LEFT JOIN transcript_chunks tc ON tc.episode_id = e.id
        GROUP BY e.id, e.video_id, e.title, e.publication_date, e.status,
                 e.error_message, s.podcast_id, p.display_name, s.name
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


@app.post("/admin/episodes/cache/bust", tags=["admin"], dependencies=[Depends(verify_blurb_token)])
async def bust_episodes_cache() -> dict:
    """Force the next /episodes request to re-query the DB."""
    _episodes_cache["data"] = None
    _episodes_cache["fetched_at"] = 0.0
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
    page: int = Query(1, ge=1, description="Page number (1-based)"),
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
    rows = await pool.fetch(
        """
        SELECT id::text, episode_id::text, chunk_index, text, start_time, end_time,
               duration, start_formatted, start_minutes, word_count,
               podcast_id, podcast_name, source_name, episode_title, video_id, publication_date
        FROM transcript_chunks
        WHERE episode_id = $1
          AND chunk_index BETWEEN $2 - $3 AND $2 + $3
        ORDER BY chunk_index
        """,
        center["episode_id"], center["chunk_index"], radius,
    )
    return [ChunkResult(**dict(row)) for row in rows]


@app.get("/podcasts", tags=["search"], response_model=list[PodcastResult])
async def podcasts() -> list[PodcastResult]:
    pool = db.get_pool()
    rows = await pool.fetch(
        """
        SELECT p.id, p.display_name, p.description, p.image, p.theme,
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
