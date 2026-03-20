-- Migration 020: remove dead 'downloaded' status (replaced by ephemeral audio in migration 014).
-- The 'queued' status is not needed — 'discovered' serves as the download queue.
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'transcribing', 'processed', 'failed'));
