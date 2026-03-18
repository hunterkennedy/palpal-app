-- Migration 014: ephemeral audio
-- Audio files are no longer stored persistently. Clear stale paths and reset
-- any episodes stuck in downloaded/downloading so they re-enter the pipeline.

UPDATE episodes
SET audio_path = NULL
WHERE audio_path IS NOT NULL;

UPDATE episodes
SET status = 'discovered', error_message = 'Reset: ephemeral audio migration'
WHERE status IN ('downloaded', 'downloading')
  AND blacklisted = FALSE;
