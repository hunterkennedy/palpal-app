-- Migration 040: admin console foundations.
--
-- The admin panel used to be a single static HTML page that polled three
-- endpoints every 3 seconds and re-rendered whole tables. This migration adds
-- the pieces a real console needs:
--
--   * job progress/attempts/priority/finished_at, so the queue can show what a
--     worker is actually doing instead of just "claimed"
--   * a statement-level NOTIFY trigger on every table the console watches, so
--     conductor can push invalidations over SSE instead of being polled
--   * live worker state on heartbeats (what blurb is doing right now, not just
--     "it was seen recently")

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS attempts    INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS priority    INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS progress    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS progress_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- History pagination and the active queue's new priority ordering.
CREATE INDEX IF NOT EXISTS idx_jobs_history_created
    ON jobs (created_at DESC) WHERE status IN ('completed', 'failed');
CREATE INDEX IF NOT EXISTS idx_jobs_active_priority
    ON jobs (priority DESC, created_at) WHERE status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS idx_jobs_progress_at
    ON jobs (progress_at DESC) WHERE status = 'claimed';

-- Keep bookkeeping consistent no matter which code path moves a job:
-- attempts count a real claim, finished_at is stamped exactly once on the
-- transition out of an active state, and a retried job starts clean.
CREATE OR REPLACE FUNCTION jobs_track_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'claimed' AND OLD.status IS DISTINCT FROM 'claimed' THEN
        NEW.attempts    := COALESCE(OLD.attempts, 0) + 1;
        NEW.claimed_at  := COALESCE(NEW.claimed_at, NOW());
        NEW.progress    := '{}'::jsonb;
        NEW.progress_at := NULL;
        NEW.finished_at := NULL;
    ELSIF NEW.status IN ('completed', 'failed') AND OLD.status IS DISTINCT FROM NEW.status THEN
        NEW.finished_at := NOW();
    ELSIF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
        NEW.finished_at := NULL;
        NEW.claimed_at  := NULL;
        NEW.claimed_by_worker := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_track_lifecycle ON jobs;
CREATE TRIGGER trg_jobs_track_lifecycle
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION jobs_track_lifecycle();

-- Live worker state. Last-seen alone says "blurb was alive 20s ago"; these
-- columns say "blurb is transcribing episode X at 43%".
ALTER TABLE worker_heartbeats
    ADD COLUMN IF NOT EXISTS state   TEXT,
    ADD COLUMN IF NOT EXISTS stage   TEXT,
    ADD COLUMN IF NOT EXISTS job_id  TEXT,
    ADD COLUMN IF NOT EXISTS detail  TEXT,
    ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Statement-level change notifications. Row-level triggers would emit one
-- NOTIFY per episode in a bulk action; a single notification per statement is
-- all the console needs because it debounces and refetches affected queries.
CREATE OR REPLACE FUNCTION notify_admin_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'palpal_admin',
        json_build_object('table', TG_TABLE_NAME, 'op', TG_OP)::text
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_notify_episodes ON episodes;
CREATE TRIGGER trg_admin_notify_episodes
    AFTER INSERT OR UPDATE OR DELETE ON episodes
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();

DROP TRIGGER IF EXISTS trg_admin_notify_jobs ON jobs;
CREATE TRIGGER trg_admin_notify_jobs
    AFTER INSERT OR UPDATE OR DELETE ON jobs
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();

DROP TRIGGER IF EXISTS trg_admin_notify_sources ON sources;
CREATE TRIGGER trg_admin_notify_sources
    AFTER INSERT OR UPDATE OR DELETE ON sources
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();

DROP TRIGGER IF EXISTS trg_admin_notify_podcasts ON podcasts;
CREATE TRIGGER trg_admin_notify_podcasts
    AFTER INSERT OR UPDATE OR DELETE ON podcasts
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();

DROP TRIGGER IF EXISTS trg_admin_notify_settings ON settings;
CREATE TRIGGER trg_admin_notify_settings
    AFTER INSERT OR UPDATE OR DELETE ON settings
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();

DROP TRIGGER IF EXISTS trg_admin_notify_workers ON worker_heartbeats;
CREATE TRIGGER trg_admin_notify_workers
    AFTER INSERT OR UPDATE OR DELETE ON worker_heartbeats
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();

DROP TRIGGER IF EXISTS trg_admin_notify_whats_new ON whats_new;
CREATE TRIGGER trg_admin_notify_whats_new
    AFTER INSERT OR UPDATE OR DELETE ON whats_new
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();
