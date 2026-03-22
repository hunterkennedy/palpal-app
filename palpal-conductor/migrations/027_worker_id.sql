-- Migration 027: track which worker instance claimed a transcription job
ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS claimed_by_worker TEXT;
