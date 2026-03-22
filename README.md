<p align="center">
  <img src="palpal-frontend/public/title.png" alt="palpal" width="220" />
</p>

<p align="center">
  Search podcast transcripts. Find the exact moment someone said the thing. Jump right to it on YouTube.
</p>

---

palpal is a self-hosted podcast search engine. Every episode gets downloaded, transcribed, chunked, and indexed. You type a phrase, you get back the clip — with a link to the timestamp.

The whole stack lives here: database, pipeline, transcription coordination, and frontend. The only thing outside Docker is [blurb](https://github.com/hunterkennedy/blurb), a Whisper transcription service designed to run on GPU hardware you already have — a gaming PC, a home server, anything with a decent card. Blurb connects outbound to conductor to pick up work; it doesn't need to be reachable from the outside.

---

## How it works

```
YouTube playlist/channel
        │
        ▼
  palpal-conductor          discovers new episodes, downloads audio, queues for transcription
        │
        │  (pull — blurb connects outbound, claims jobs, posts results back)
        │
  blurb              transcribes audio on your GPU hardware
        │
        ▼
  palpal-conductor          receives transcript, chunks it, writes to postgres
        │
        ▼
    postgres                stores everything, full-text search via tsvector
        │
        ▼
  palpal-frontend           search UI, served on your chosen port
```

Everything in the pipeline is automatic once configured. A persistent download worker runs inside conductor, draining the queue one episode at a time (newest-first, so fresh discoveries are processed before old backlog). The scheduler runs discovery every 24 hours; new episodes work their way through without intervention.

---

## Prerequisites

- **Docker + Docker Compose**
- **[blurb](https://github.com/hunterkennedy/blurb)** running somewhere with a GPU. Blurb connects *outbound* to conductor to claim transcription jobs — no inbound ports or firewall rules needed on the blurb side. Configure blurb with `CONDUCTOR_URL` pointing at your conductor and the same `BLURB_API_KEY` set on both sides.

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
| `AUDIO_HOST_PATH` | Host directory where downloaded audio is staged before transcription (e.g. `/home/you/palpal-audio`) |
| `APP_PORT` | Port the frontend listens on (default `3001`) |
| `ADMIN_PASSWORD` | Password for the admin panel login page |
| `ADMIN_SESSION_TOKEN` | Long random string used as the session cookie value — generate with `openssl rand -hex 32` |

Create the audio directory before starting:

```bash
mkdir -p /path/to/your/palpal-audio
```

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

This is the control room for the pipeline. From here you can:

- **Trigger discovery** — scan YouTube playlists/channels for new episodes (runs automatically every 24h, or kick it off manually here)
- **Start the download queue** — the download worker runs automatically on startup; the `▶ dl` button wakes it immediately if you want to kick off processing now
- **Monitor status** — counts per pipeline stage, download worker state (active/idle), recent failures, episodes stuck in transcription
- **Retry failures** — re-queue a failed episode; it goes back to `discovered` and the worker picks it up
- **Pause/resume the scheduler** — stops automatic discovery and reclaim jobs; the download worker continues running

> **First run:** discovery may find a large backlog. The `max_new` filter on each source in the DB caps how many new episodes are discovered per run — bump it in the `sources` table when you're ready to process history.

---

## Using the app

Open `http://localhost:$APP_PORT`. Type something a podcast host said. Get back the clip.

- **Filter by podcast** — or search across all of them at once
- **Sort** by relevance, publish date, or clip duration
- **Date range** — narrow down to recent episodes or a specific window
- **Expand context** — see the chunks before and after a result for more of the conversation
- **Jump to timestamp** — every result links directly to the right moment on YouTube

---

## Maintenance

### Check pipeline health

```bash
curl -s http://localhost:8000/admin/status \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq
```

Returns counts by status, recent failures with error messages, and any episodes stuck in `transcribing` for more than 2 hours.

### Diagnose a failure

```bash
# Check error_message first — it covers most cases
curl -s http://localhost:8000/admin/status \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq '.recent_failures'

# Grep logs by episode ID for more detail
docker logs palpal-conductor 2>&1 | grep <episode_id>
```

### Retry an episode

```bash
curl -s -X POST http://localhost:8000/admin/episodes/<episode_id>/retry \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq
```

The episode resets to `discovered` and the download worker picks it up on the next cycle.

### Trigger discovery manually

```bash
# All podcasts
curl -s -X POST http://localhost:8000/admin/discover \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq

# One podcast
curl -s -X POST "http://localhost:8000/admin/discover?podcast_id=pal" \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq
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

### Other useful commands

```bash
# Live logs
docker logs -f palpal-conductor

# Episode counts by status
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT status, COUNT(*) FROM episodes GROUP BY status ORDER BY status;"

# Pending transcription jobs (waiting for blurb worker)
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT status, COUNT(*) FROM transcription_jobs GROUP BY status;"
```

---

## Updating

```bash
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
