-- Migration 017: index cleanup
--
-- Remove dead indexes (no queries use them):
--   idx_chunks_pub_date   — /search always sorts by ts_rank, never by pub_date alone
--   idx_chunks_duration   — no query filters/sorts chunks by duration
--   idx_episodes_source_id — leading column of idx_episodes_source_video makes this redundant
--
-- Remove unused extension:
--   pg_trgm — installed but no trigram indexes or LIKE queries exist
--
-- Add missing indexes:
--   idx_episodes_status_active  — partial index covering the common (status + blacklisted=FALSE) pattern
--   idx_episodes_status_updated — composite for admin queries: status filter + updated_at sort

DROP INDEX IF EXISTS idx_chunks_pub_date;
DROP INDEX IF EXISTS idx_chunks_duration;
DROP INDEX IF EXISTS idx_episodes_source_id;

DROP EXTENSION IF EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_episodes_status_active
    ON episodes(status) WHERE blacklisted = FALSE;

CREATE INDEX IF NOT EXISTS idx_episodes_status_updated
    ON episodes(status, updated_at DESC);
