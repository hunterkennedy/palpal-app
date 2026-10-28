-- Migration 041: per-job event timeline.
--
-- Progress percentages were already stored on jobs, but there was no history of
-- what happened during a job. This table keeps meaningful events (claimed,
-- stage transitions, failures, cancellation) plus one rolling progress row per
-- stage, so the admin job drawer can show a timeline and recent log lines
-- without unbounded growth.

CREATE TABLE IF NOT EXISTS job_events (
    id         BIGSERIAL   PRIMARY KEY,
    job_id     UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    level      TEXT        NOT NULL DEFAULT 'info'
                               CHECK (level IN ('info', 'progress', 'warning', 'error')),
    stage      TEXT,
    percent    NUMERIC(5,2),
    message    TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_created
    ON job_events (job_id, created_at DESC);

-- Only one rolling progress row per (job, stage). Meaningful events are
-- separate rows and are never collapsed.
CREATE UNIQUE INDEX IF NOT EXISTS job_events_one_progress_per_stage
    ON job_events (job_id, stage) WHERE level = 'progress';

DROP TRIGGER IF EXISTS trg_admin_notify_job_events ON job_events;
CREATE TRIGGER trg_admin_notify_job_events
    AFTER INSERT OR UPDATE OR DELETE ON job_events
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();
