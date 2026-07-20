-- Migration 033: generic worker job queue, replacing transcription_jobs.
--
-- Discovery and download now happen entirely on blurb (it owns the YouTube/
-- Patreon credentials), so the single-purpose transcription_jobs table is
-- replaced by a generic queue that carries two job kinds:
--   'discover' — scrape one source, return new/seen entries (+ optional icon)
--   'process'  — download + transcribe one episode, return the transcript
--
-- payload/result shapes are conductor<->blurb protocol, not enforced by schema.

CREATE TABLE IF NOT EXISTS jobs (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind              TEXT        NOT NULL CHECK (kind IN ('discover', 'process')),
    status            TEXT        NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
    payload           JSONB       NOT NULL,
    result            JSONB,
    error             TEXT,
    error_type        TEXT,
    claimed_at        TIMESTAMPTZ,
    claimed_by_worker TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at)
    WHERE status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS idx_jobs_kind_status ON jobs (kind, status);

DROP TABLE IF EXISTS transcription_jobs;
