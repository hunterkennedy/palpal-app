# palpal-app infrastructure

## Setup

```bash
cp .env.example .env
```

> **Fedora/RHEL (SELinux):** the `:z` suffix on bind mounts in `docker-compose.yml` is required and already set. Without it postgres can't read the init scripts.

---

## Start

```bash
# Postgres only (fastest way to test schema + seed)
docker compose up -d postgres

# Full stack
docker compose up -d
```

---

## Conductor

### Maintenance workflow

**1. Check status** — start here when something seems wrong:

```bash
curl -s http://localhost:8000/admin/status \
  -H "Authorization: Bearer <BLURB_API_KEY>" | jq
```

Returns episode counts by status, recent failures with `error_message`, and any episodes still in `transcribing`.

**2. Diagnose** — `error_message` in the response covers most failures. For more detail, grep logs by episode ID:

```bash
docker logs palpal-conductor 2>&1 | grep <episode_id>
```

**3. Retry** — once you've understood and fixed the cause:

```bash
# Re-queue a specific failed (or stuck) episode
curl -s -X POST http://localhost:8000/admin/episodes/<episode_id>/retry \
  -H "Authorization: Bearer <BLURB_API_KEY>" | jq

# Re-run discovery if episodes are missing
curl -s -X POST http://localhost:8000/admin/discover \
  -H "Authorization: Bearer <BLURB_API_KEY>" | jq
```

**4. Verify** — re-check `/admin/status` and watch the count move from `failed` → `processed`.

---

### Common failure patterns

| `error_message` contains | Likely cause | Fix |
|---|---|---|
| `yt-dlp download failed` | Rate-limited or video unavailable | Wait and retry, or check the video URL |
| `Blurb returned 4xx/5xx` | Blurb is down or rejected the file | Check blurb logs, retry when healthy |
| `Blurb reported failure` | Whisper failed on this audio | Check blurb logs for the job |
| `process_transcript:` | Bad transcript shape from blurb | Check blurb output, may need a blurb fix |
| `no file found matching` | yt-dlp ran but produced no output | Run yt-dlp manually against the video URL |

---

### Other commands

```bash
# Live logs
docker logs -f palpal-conductor

# Confirm only one download at a time
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT COUNT(*) FROM episodes WHERE status = 'downloading';"

# Raw status breakdown in psql
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT status, COUNT(*) FROM episodes GROUP BY status ORDER BY status;"
```

---

## Test

```bash
# Tables exist
docker compose exec postgres psql -U palpal -d palpal -c "\dt"
# Expected: episodes, podcasts, sources, transcript_chunks

# 6 podcasts seeded in order
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT id, display_name, display_order FROM podcasts ORDER BY display_order;"

# 8 sources seeded
docker compose exec postgres psql -U palpal -d palpal \
  -c "SELECT podcast_id, name, site FROM sources ORDER BY podcast_id, name;"

# FTS trigger fires on insert
docker compose exec postgres psql -U palpal -d palpal -c "
  INSERT INTO episodes (source_id, video_id, title)
    SELECT id, 'test-vid', 'Test Episode' FROM sources LIMIT 1
    RETURNING id \gset

  INSERT INTO transcript_chunks
    (episode_id, text, chunk_index, start_time, end_time, duration, podcast_id, podcast_name, episode_title, video_id)
  VALUES
    (:'id', 'hello world', 0, 0, 5, 5, 'pal', 'Podcast About List', 'Test Episode', 'test-vid')
    RETURNING search_vector;
"
# Expected: search_vector is non-null
```

---

## Reset

```bash
# Wipe data volume and re-run init scripts (schema + seed)
docker compose down -v
docker compose up -d postgres

# Restart a single service without touching the volume
docker compose restart postgres

# Recreate a service from scratch (pulls image, re-mounts volume)
docker compose up -d --force-recreate postgres
```
