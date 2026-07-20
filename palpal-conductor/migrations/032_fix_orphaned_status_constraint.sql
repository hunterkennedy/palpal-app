-- Migration 032: migration 029 rewrote the episodes.status CHECK constraint
-- and accidentally dropped 'orphaned' (added in 024). Discovery's orphaning
-- UPDATE has been silently failing the constraint ever since. Restore it.

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'downloaded', 'transcribing', 'processed', 'failed', 'blacklisted', 'orphaned'));
