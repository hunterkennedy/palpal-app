<p align="center">
  <img src="palpal-frontend/public/title.png" alt="palpal" width="220" />
</p>

<p align="center">
  Search podcast transcripts. Find the exact moment someone said the thing. Jump right to it on YouTube.
</p>

---

palpal is a self-hosted podcast search engine. Every episode gets discovered, downloaded, transcribed, chunked, and indexed. You type a phrase, you get back the clip — with a link to the timestamp.

The whole stack lives here: database, job queue, search, and frontend. The only thing outside Docker is [blurb](https://github.com/hunterkennedy/blurb), a pull-worker that runs on GPU hardware you already have — a gaming PC, a home server, anything with a decent card. Blurb connects outbound to conductor to pick up work; it doesn't need to be reachable from the outside.

Everything that needs your YouTube/Patreon login — discovery and audio download — runs on blurb, using cookies that live only on blurb's own disk. Conductor, which is the one part of the stack reachable from the internet, never sees those credentials. It only ever hands out source URLs and receives back episode metadata and transcripts.

---

## How it works

```
  palpal-conductor          enqueues discover/process jobs, tracks episode state
        │
        │  (pull — blurb connects outbound, claims jobs, posts results back)
        │
  blurb              scrapes YouTube/Patreon sources, downloads audio, transcribes — all locally
        │
        ▼
  palpal-conductor          applies discovery results, chunks the transcript, writes to postgres
        │
        ▼
    postgres                stores everything, full-text search via tsvector
        │
        ▼
  palpal-frontend           search UI, served on your chosen port
```

Everything in the pipeline is automatic once configured. Conductor enqueues a `discover` job per YouTube, Patreon, or RSS/Atom source on a schedule (every 6h) and a `process` job for every newly-discovered episode; blurb polls, claims one job at a time, and does the work — audio never touches conductor's disk.

---

## Prerequisites

- **Docker + Docker Compose**
- **[blurb](https://github.com/hunterkennedy/blurb)** running somewhere with a GPU. Blurb connects *outbound* to conductor to claim jobs — no inbound ports or firewall rules needed on the blurb side. Configure blurb with `WEB_URL` pointing at your conductor and the same `BLURB_API_KEY` set on both sides. Your YouTube/Patreon cookies are configured on blurb, not here — see blurb's README.

---

## First-time setup

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | What it's for |
|---|---|
| `POSTGRES_PASSWORD` | Password for the Postgres user |
| `DATABASE_URL` | Full connection string — update to match if you changed `POSTGRES_PASSWORD` |
| `BLURB_API_KEY` | Shared secret between conductor and blurb — set the same value in your blurb config |
| `CONDUCTOR_ADMIN_KEY` | Secret for the conductor admin API — make it strong |
| `APP_PORT` | Port the frontend listens on (default `3001`) |
| `ADMIN_PASSWORD` | Password for the admin panel login page |

> **Fedora/RHEL (SELinux):** the `:z` suffix on bind mounts in `docker-compose.yml` is already set. Without it Postgres can't read the init scripts.

---

## Start

```bash
docker compose up -d
```

Three services come up:

| Service | What it does | Default port |
|---|---|---|
| `postgres` | Database — schema and seed data applied automatically on first start | `5432` (localhost only) |
| `palpal-conductor` | Pipeline + worker API | `$CONDUCTOR_PORT` (default `8000`, localhost only) |
| `palpal-frontend` | Search UI + admin panel | `$APP_PORT` (default `3001`, localhost only) |

Check everything started cleanly:

```bash
docker compose ps
docker logs palpal-conductor
```

---

## Admin panel

Open `http://localhost:$APP_PORT/admin` and log in with `ADMIN_PASSWORD`.

The admin console is a live console backed by conductor's job queue. It updates
over a server-sent event stream, so counts, job state, and worker progress move
as things happen instead of on a polling timer.

- **Overview** — pipeline state, queue depth, per-podcast stage counts, active
  jobs with live download/transcription progress, recent failures, and blurb's
  current state.
- **Episodes** — server-filtered, sortable episode table (status, podcast,
  source, title). Inspect one episode for its full job history and transcript
  stats; process, retry, re-transcribe, blacklist, or delete. Bulk actions work
  across the current filter, not just the visible page.
- **Jobs** — the active queue (cancel, prioritize, watch progress) and a
  filterable history of completed/failed jobs with one-click retry.
- **Podcasts** — podcast metadata, drag-free ordering, and per-source config
  (URL, site, title exclusions, enabled state, last discovery result). Run
  discovery for one source, one podcast, or everything.
- **Content** — What's New entries and the rotating search-bar placeholders.
- **Settings** — auto-discovery/auto-download, duration floor, chunk size,
  scheduler state, re-chunking, and job-history cleanup.

Pausing processing only stops `process` jobs from being claimed. Discovery and
the stuck-job reclaim sweep keep running; explicit admin actions still bypass
the auto-download setting.

> **First run:** discovery may find a large backlog. Use **Discover only** (or
> disable auto-download first) to review what a source returns before queuing
> the whole history.

---

## Using the app

Open `http://localhost:$APP_PORT`. Type something a podcast host said. Get back the clip.

- **Filter by podcast** — or search across all of them at once
- **Sort** by relevance, publish date, or clip duration
- **Date range** — narrow down to recent episodes or a specific window
- **Expand context** — see the chunks before and after a result for more of the conversation
- **Jump to timestamp** — YouTube and Patreon results link directly to the right moment; RSS results are searchable but intentionally have no external watch link, since the feed URL carries a private token

---

## Maintenance

The admin panel shows pipeline health, recent failures, and lets you retry episodes or trigger discovery manually.

For logs:

```bash
docker logs -f palpal-conductor
```

### Common failure patterns

| `error_message` contains | Likely cause | Fix |
|---|---|---|
| `yt-dlp download failed` | Generic yt-dlp error | Check the video URL; run yt-dlp manually against it |
| `private or unavailable` | Video was deleted or made private | Episode resets to `discovered` automatically and won't block the queue |
| `Rate limited` | YouTube 429 | Worker backs off 60s automatically; retry will happen next cycle |
| `Worker: <message>` | Blurb worker reported a transcription failure | Check blurb logs; retry the episode once blurb is healthy |
| `process_transcript:` | Bad transcript shape from blurb | Check blurb output format; may need a blurb fix |
| `no file found matching` | yt-dlp ran but produced no output | Run yt-dlp manually against the video URL |

---

## Updating

```bash
git pull
docker compose up -d --build
```

---

## Reset

```bash
# Wipe everything and start fresh (deletes all episodes and transcripts)
docker compose down -v && docker compose up -d

# Restart one service without touching data
docker compose restart palpal-conductor

# Rebuild and recreate one service
docker compose up -d --build --force-recreate palpal-conductor
```
