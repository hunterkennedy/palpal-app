-- Migration: add 'downloaded' to episode status state machine
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'downloaded', 'transcribing', 'processed', 'failed'));
