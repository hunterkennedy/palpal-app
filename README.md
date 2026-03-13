# palpal

Podcast transcript search engine. Search across episode transcripts by keyword, filter by podcast or date range, and jump directly to the moment in the episode where it was said.

---

## Prerequisites

- **Docker + Docker Compose**
- **[palpal-blurb](../palpal-blurb)** running on the host machine at port `8001` — this is the transcription service (GPU-based Whisper). The conductor container reaches it via `host.docker.internal:8001`.

---

## First-time setup

**1. Configure environment variables:**

```bash
cp .env.example .env
```

Edit `.env` and set:

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Password for the Postgres user |
| `DATABASE_URL` | Full connection string — update if you changed `POSTGRES_PASSWORD` |
| `BLURB_API_KEY` | Shared secret between conductor and blurb — set the same value in your blurb config |
| `CONDUCTOR_ADMIN_KEY` | Secret for the conductor admin panel — can be anything strong |
| `AUDIO_HOST_PATH` | Host directory where downloaded audio files are stored (e.g. `/home/you/palpal-audio`) |
| `APP_PORT` | Port the frontend listens on (default `3001`) |

> **Fedora/RHEL (SELinux):** the `:z` suffix on bind mounts in `docker-compose.yml` is already set and required. Without it Postgres can't read the init scripts.

**2. Create the audio directory** (must exist before starting):

```bash
mkdir -p /path/to/your/palpal-audio   # whatever you set as AUDIO_HOST_PATH
```

---

## Starting the stack

```bash
docker compose up -d
```

This starts:
- **postgres** — database (schema and seed data applied automatically on first run)
- **palpal-conductor** — pipeline + API (`http://localhost:$CONDUCTOR_PORT`)
- **palpal-frontend** — search UI (`http://localhost:$APP_PORT`)

Check that everything came up:

```bash
docker compose ps
docker logs palpal-conductor
```

---

## Getting content in

Content enters the system through the pipeline: **discover → download → transcribe → process**.

Open the admin panel at `http://localhost:8000/admin` (replace `8000` with your `CONDUCTOR_PORT`).

From there you can:
- **Trigger discovery** for all podcasts or a specific one — this queries YouTube playlists/channels for new episodes and adds them to the DB as `discovered`
- **Process episodes** — kicks off download + transcription for a specific episode, or let auto-processing handle it
- **Monitor status** — see counts per pipeline stage, recent failures, and stuck episodes
- **Retry failures** — re-queue individual failed or stuck episodes
- **Pause/resume the scheduler** — stops automatic 24-hour discovery runs

Discovery also runs automatically every 24 hours. Once an episode is discovered, the pipeline downloads its audio and sends it to blurb for transcription. Transcripts are chunked and indexed for full-text search.

> **Note:** The first run on a podcast may queue many episodes at once. The `max_new` filter in the seed data caps new episodes per discovery run — increase it (or remove it) in the `sources` table once you're ready to process the full backlog.

---

## Using the app

Open `http://localhost:$APP_PORT` in your browser.

- **Search** — type any phrase to search across all transcripts; results show the matching chunk with surrounding context
- **Filter by podcast** — restrict results to a single podcast
- **Sort** — by relevance, date, or clip duration
- **Date range** — filter by when the episode was published
- **Expand context** — click a result to see surrounding chunks from the same episode
- **Jump to timestamp** — each result links directly to the YouTube timestamp

---

## Maintenance

### Check pipeline status

```bash
curl -s http://localhost:8000/admin/status \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq
```

Returns episode counts by status, recent failures with error messages, and any episodes stuck in `transcribing`.

### Diagnose a failure

```bash
# Error message is usually enough — check it first
curl -s http://localhost:8000/admin/status \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq '.recent_failures'

# For more detail, grep logs by episode ID
docker logs palpal-conductor 2>&1 | grep <episode_id>
```

### Retry a failed episode

```bash
curl -s -X POST http://localhost:8000/admin/episodes/<episode_id>/retry \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq
```

Automatically skips re-download if the audio file is already on disk.

### Run discovery manually

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
| `yt-dlp download failed` | Rate-limited or video unavailable | Wait and retry, or check the video URL |
| `Blurb returned 4xx/5xx` | Blurb is down or rejected the file | Check blurb logs, retry when healthy |
| `Blurb reported failure` | Whisper failed on this audio | Check blurb logs for the job ID |
| `process_transcript:` | Bad transcript shape from blurb | Check blurb output; may need a blurb fix |
| `no file found matching` | yt-dlp ran but produced no output | Run yt-dlp manually against the video URL |

### Other useful commands

```bash
# Live conductor logs
docker logs -f palpal-conductor

# Episode status breakdown in psql
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT status, COUNT(*) FROM episodes GROUP BY status ORDER BY status;"

# Confirm only one download is running at a time
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT COUNT(*) FROM episodes WHERE status = 'downloading';"
```

---

## Updating

```bash
docker compose pull          # if using remote images
docker compose up -d --build # rebuild from local Dockerfiles
```

---

## Reset

```bash
# Wipe DB volume and re-run schema + seed (destructive — deletes all episodes and transcripts)
docker compose down -v
docker compose up -d

# Restart a single service without touching data
docker compose restart palpal-conductor

# Rebuild and recreate a specific service
docker compose up -d --build --force-recreate palpal-conductor
```
