-- Migration 023: Split download and transcription into separate pipeline stages.
-- Re-adds 'downloaded' episode status so a pre-fetch worker can hold audio ready.
-- Adds 'queued' transcription_jobs status so blurb workers only see 'pending' jobs.

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'downloaded', 'transcribing', 'processed', 'failed'));

ALTER TABLE transcription_jobs DROP CONSTRAINT IF EXISTS transcription_jobs_status_check;
ALTER TABLE transcription_jobs ADD CONSTRAINT transcription_jobs_status_check
    CHECK (status IN ('queued', 'pending', 'claimed', 'completed', 'failed'));
