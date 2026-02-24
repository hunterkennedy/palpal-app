# palpal-app infrastructure

## Setup

```bash
cp .env.example .env
```

---

## Start

```bash
# Postgres only (fastest way to test schema + seed)
docker compose up -d postgres

# Full stack
docker compose up -d
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

# Temporal UI
open http://localhost:8080
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
