-- Migration 035: 'downloaded' and 'transcribing' episode statuses are no
-- longer produced now that download+transcribe are a single 'process' job
-- handled entirely by blurb — everything in flight is just 'downloading'.
-- Reset any leftover rows from before this change and drop them from the
-- allowed set.

UPDATE episodes
SET status = 'discovered', error_message = 'Reset: status retired by architecture change'
WHERE status IN ('downloaded', 'transcribing');

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'processed', 'failed', 'blacklisted', 'orphaned'));
