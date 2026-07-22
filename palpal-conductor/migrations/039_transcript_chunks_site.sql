-- Migration 039: denormalize `site` onto transcript_chunks, same pattern as
-- source_name/podcast_name already being denormalized there. Needed so the
-- frontend can pick the right "watch" link (YouTube/Patreon/RSS) for a search
-- hit without guessing from source_name text — that heuristic (source_name
-- containing "patreon") broke once a third site type (RSS) existed, since
-- there's no way to distinguish "not Patreon" from "RSS" without it lying
-- about being YouTube.

ALTER TABLE transcript_chunks ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT '';

UPDATE transcript_chunks tc
SET site = s.site
FROM episodes e
JOIN sources s ON s.id = e.source_id
WHERE e.id = tc.episode_id
  AND tc.site = '';
