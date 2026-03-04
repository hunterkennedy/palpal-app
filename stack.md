palpal is a podcast transcript search app.

---

## Architecture Overview

```
[APScheduler in conductor]
  - Discovery job every 24h (reads sources from DB, auto-queues episodes)
  - Recovery job daily at 10:00 (resubmits stuck transcribing episodes)

[Pipeline in conductor]
  - Episode discovery (yt-dlp --flat-playlist → DB insert)
  - Download (yt-dlp → Docker volume, one at a time via semaphore)
  - POST audio to blurb
  - Webhook receiver → transcript processing → DB write

[FastAPI in conductor]
  - GET  /search                              (FTS with ts_headline highlights)
  - GET  /chunks
  - GET  /podcasts
  - GET  /episodes
  - GET  /episodes/check
  - GET  /health
  - GET  /admin/status
  - GET  /admin/scheduler/status
  - POST /blurb/webhook/{job_id}
  - POST /admin/discover                      (?podcast_id=, ?auto_queue=)
  - POST /admin/scheduler/pause
  - POST /admin/scheduler/resume
  - POST /admin/episodes/{id}/retry
  - POST /admin/episodes/{id}/process
  - POST /admin/episodes/cache/bust

[palpal-frontend] → [FastAPI in conductor] → [Postgres]
[palpal-blurb]    → receives audio POST, sends webhook back to conductor
```

---

## palpal-conductor (complete)

**Stack:** Python + FastAPI + APScheduler

Data management and orchestration platform. Contains two things running together:
- **FastAPI app** — HTTP API for the frontend and blurb
- **Pipeline** — APScheduler + asyncio for discovery, download, and transcription

### Feed/source discovery
- Sources defined in the postgres DB (YouTube playlists or channels)
- Episode discovery runs on a 24-hour APScheduler interval (or triggered via `/admin/discover`)
- `auto_queue=false` discovers without downloading — used by the admin panel for manual testing
- New episodes are processed as asyncio tasks, one download at a time (semaphore)

### Download pipeline
- Audio downloaded via yt-dlp
- Raw audio stored on a Docker volume, then POSTed to blurb
- Episode status tracked in DB: discovered → downloading → transcribing → processed / failed
- Stuck episodes (left in transcribing) are automatically resubmitted daily at 10:00

### Blurb coordination
- Auth: shared API key in `Authorization` header, configured via env vars on both sides
- Blurb POSTs completed transcripts to `/blurb/webhook/{job_id}`

### Transcript processing
- Webhook receiver accepts raw transcript from blurb
- Chunks transcript into searchable segments
- Writes chunks + episode metadata to postgres
- Raw segments also saved to `transcripts` table (source of truth for re-chunking)

### Search API
- `GET /search` — FTS via websearch_to_tsquery; supports relevance/date/duration sort, per-podcast filter, date range; returns `ts_headline` highlights with `<mark>` tags
- `GET /chunks` — adjacent chunk fetching by UUID + radius (for context expansion)
- `GET /podcasts` — podcast/source list from DB

---

## palpal-blurb (complete)

Transcription app. Lives on local PC, uses GPU. Operates at random hours. Runs natively (not in Docker) due to GPU requirements.

- `/health` endpoint
- Job submission via `POST /jobs`
- Whisper transcription with faster-whisper (`distil-large-v3`, batched, GPU)
- API key auth system (this doubles as the shared secret mechanism with conductor)
- Job status tracking in memory
- Startup/shutdown hooks — registers/deregisters with conductor (conductor ignores unknown routes gracefully)
- Webhook push — POSTs completed transcript to `{CONDUCTOR_URL}/blurb/webhook/{job_id}` (no polling)
- Job timeout — configurable via `JOB_TIMEOUT_SECONDS`, marks job failed and notifies conductor
- Concurrency guard — rejects new jobs with 503 while one is active (single GPU)
- Manager UI — `blurb_manager.py` Tkinter window with start/stop and live stats; auto-starts on login

---

## palpal-db (complete)

**Stack:** Postgres in Docker, pure local, no Supabase

Schema managed via init scripts (`/initdb/`) that run automatically on first container start.

### Tables
- `podcasts` — id, display_name, description, image, theme (JSONB), social_sections (JSONB), enabled, display_order
- `sources` — podcast_id, name, site, type, url, fetch_url, description, filters (JSONB), enabled
- `episodes` — id, source_id, video_id, title, publication_date, audio_path, status, error_message
  - status: `discovered | downloading | transcribing | processed | failed`
- `transcripts` — episode_id, language, segments (JSONB); raw blurb output, source of truth for re-chunking
- `transcript_chunks` — episode_id, text, chunk_index, start/end times, duration, word_count, denormalized podcast/episode metadata, tsvector for FTS

### Full-text search
- `search_vector` TSVECTOR on `transcript_chunks`, populated via trigger at insert
  - text → weight A, episode_title → weight B, podcast_name → weight C
- GIN index on search_vector
- Additional indexes: podcast_id, publication_date, (podcast_id, publication_date), duration

---

## palpal-frontend (complete)

**Stack:** Next.js 15 + React 19 + TypeScript + Tailwind CSS 4

Search frontend. Queries conductor directly — no MeiliSearch.

### Search flow
- Client → `GET /api/search` (Next.js route) → conductor `/search`
- Highlights (`text_highlighted`, `title_highlighted`) from `ts_headline`, rendered with `<mark>` tags and DOMPurify
- Podcast filter: single `podcast_id` param when one podcast selected; omit to search all
- Date range presets (last week/month/3 months/year) computed to ISO date strings server-side

### Context expansion
- Client → `GET /api/chunks?chunkId=&radius=` → conductor `/chunks`

### Admin panel (`/admin`)
- Scheduler status (paused/running), pause/resume toggle
- Per-podcast **Discover** button — runs discovery with `auto_queue=false` (episodes land as `discovered`, no download)
- **Process** button on individual `discovered` episodes — triggers download + transcription for just that episode
- **Retry** button on `failed` episodes
- Episode table with live status, filterable by status, auto-refreshes every 8s
- Cache-busts conductor's episode list cache after any action

### Key env vars
- `CONDUCTOR_URL` — runtime-only, server-side (e.g. `http://palpal-conductor:8000`)
- `CONDUCTOR_ADMIN_KEY` — same value as `BLURB_API_KEY`, used by admin API routes

---

## Build Order

```
1. DB schema + Docker compose          ✓ done
        │
        ▼
2. Blurb modifications                 ✓ done
        │
        ▼
3. Conductor pipeline                  ✓ done
   (discover → download → transcribe → process)
        │
        ▼
4. Conductor search API                ✓ done
        │
        ▼
5. Frontend refactor                   ✓ done
   (MeiliSearch → conductor, admin panel)
```

---

## Docker Compose (all services)

- `postgres` — the DB
- `palpal-conductor` — FastAPI app + APScheduler pipeline
- `palpal-frontend` — Next.js app (port 3001)

Note: palpal-blurb runs natively on the host machine and is not in the compose stack.
