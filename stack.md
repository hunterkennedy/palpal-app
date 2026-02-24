palpal is a podcast transcript search app.

---

## Architecture Overview

```
[Temporal Scheduler]
        |
        v
[Temporal Worker in conductor]
  - Episode discovery workflow (reads sources from DB)
  - Download activity (yt-dlp / patreon-dl → Docker volume)
      └── rate limit hit → Temporal retry with exponential backoff
  - POST audio to blurb activity
      └── waits for blurb "hello" Signal if unavailable
  - Webhook receiver → transcript processing activity
  - DB write activity

[FastAPI in conductor]
  - GET  /search
  - GET  /chunks
  - GET  /podcasts
  - GET  /episodes/check
  - POST /blurb/register   (sends Signal to waiting Temporal workflow)
  - POST /blurb/deregister

[palpal-frontend] → [FastAPI in conductor] → [Postgres]
[palpal-blurb]    → registers/deregisters with conductor on start/stop
                  → receives audio POST, sends webhook back to conductor
```

---

## palpal-conductor (not developed)

**Stack:** Python + FastAPI + Temporal (self-hosted OSS, free, Apache 2.0)

Data management and orchestration platform. Contains two things running together:
- **FastAPI app** — HTTP API for the frontend and blurb
- **Temporal worker** — runs all pipeline workflow/activity code

### Feed/source discovery
- Sources defined in the postgres DB (YouTube playlists or Patreon collections)
- Episode discovery runs on a Temporal Schedule (replaces cron)
- New episodes are enqueued as Temporal workflow executions

### Download pipeline
- Audio downloaded via yt-dlp or patreon-dl
- Raw audio stored on a Docker volume, then POSTed to blurb
- Rate limit handling: Temporal RetryPolicy with exponential backoff — no manual retry logic needed
- Investigate yt-dlp options to reduce rate limit exposure (delays, cookies, etc.)
- Episode status tracked in DB throughout: discovered → downloading → downloaded → transcribing → transcribed → processed

### Blurb coordination
- `POST /blurb/register` — blurb calls this on startup with shared secret; conductor sends a Temporal Signal to unblock waiting workflows and drain the job queue
- `POST /blurb/deregister` — blurb calls this on shutdown; conductor pauses dispatch
- Auth: shared secret API key in `Authorization` header, configured via env vars on both sides

### Transcript processing
- Webhook receiver accepts raw transcript from blurb
- Chunks transcript into searchable segments
- Writes chunks + episode metadata to postgres

### Search API (replaces MeiliSearch)
- `GET /search` — full-text search with filter/sort support (relevance, date, duration, date range, per-podcast)
- `GET /chunks` — adjacent chunk fetching for context expansion
- `GET /podcasts` — podcast/source list from DB (replaces static JSON configs in frontend)
- `GET /episodes/check` — check if episode already exists

---

## palpal-blurb (partially developed)

Transcription app. Lives on local PC, uses GPU. Operates at random hours. Runs natively (not in Docker) due to GPU requirements.

Already implemented:
- `/health` endpoint
- Job submission via `POST /jobs`
- Whisper transcription with faster-whisper (`distil-large-v3`, batched, GPU)
- API key auth system (this doubles as the shared secret mechanism with conductor)
- Job status tracking in memory

Work remaining:
- **Add startup/shutdown hooks** to `POST /conductor/blurb/register` and `POST /conductor/blurb/deregister` on start and stop — the hello/goodbye messages that unblock the Temporal workflow queue
- **Switch from poll to webhook** — currently designed for Airflow-style polling (`GET /jobs/{id}`); needs to POST the completed transcript back to conductor instead
- **Job timeout** — if a transcription hangs, conductor needs to know; add a configurable timeout that marks the job failed and notifies conductor
- **Concurrency guard** — enforce one active job at a time (single GPU); queue or reject additional submissions while busy

---

## palpal-db (not developed)

**Stack:** Postgres in Docker, pure local, no Supabase

Schema managed via init scripts (`/docker/initdb/`) that run automatically on first container start.

### Tables
- `podcasts` — id, display_name, theme config, social links, enabled, display_order
- `sources` — podcast_id, type (youtube/patreon), url, enabled
- `episodes` — id, source_id, video_id, title, publication_date, status, audio_path
- `transcript_chunks` — episode_id, text, chunk_index, start_time, end_time, word_count, tsvector column for FTS

### Full-text search
- `tsvector` column on `transcript_chunks`, populated via trigger at insert
- `GIN` index on the tsvector column

---

## palpal-frontend (developed, needs refactoring; cloned here as palpal)

**Stack:** Next.js 15 + React 19 + TypeScript + Tailwind CSS 4

Simple search frontend. Currently queries MeiliSearch directly — needs to be updated to query core.

### Refactor required
- Remove all MeiliSearch client code (`/lib/meilisearch.ts`, `/lib/keys.ts`, MeiliSearch SDK)
- Replace Next.js API routes with proxies to palpal-conductor (or call conductor directly from client)
- Remove MeiliSearch admin/index management routes (`/api/index/*`, `/api/transcripts`)
- Replace static podcast JSON configs with live data from conductor's `/podcasts` endpoint
- Swap `MEILI_*` env vars for `CONDUCTOR_URL`
- Keep: all UI components, filtering, save/bookmark system, search debouncing, theming

---

## Build Order

MeiliSearch data will not be migrated — the shape is different and metadata is missing. The pipeline must produce real data before the frontend refactor is worth doing.

```
1. DB schema + Docker compose
        │
        ▼
2. Blurb modifications
        │
        ▼
3. Conductor pipeline (discover → download → transcribe → process)
        │
        ▼  ← real data exists in postgres here
           (can seed a few chunks manually to develop search against before pipeline is fully done)
4. Conductor search API
        │
        ▼
5. Frontend refactor
```

---

## Docker Compose (all services)

- `postgres` — the DB
- `temporal` + `temporal-ui` — workflow engine (OSS, self-hosted) and its dashboard
- `palpal-conductor` — FastAPI app + Temporal worker
- `palpal-frontend` — Next.js app

Note: palpal-blurb runs natively on the host machine and is not in the compose stack.
