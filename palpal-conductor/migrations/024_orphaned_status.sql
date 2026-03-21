-- Migration 024: Add 'orphaned' episode status.
-- Episodes are marked orphaned during discovery when they are no longer present
-- in the source (e.g. deleted, made private, source filters changed).

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'downloaded', 'transcribing', 'processed', 'failed', 'orphaned'));
