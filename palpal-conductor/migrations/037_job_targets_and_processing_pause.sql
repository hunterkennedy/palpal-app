-- Migration 037: link jobs to their real targets instead of relying solely on
-- JSONB payload text matching, and enforce "one active job per target" as a
-- real DB constraint instead of a racy app-level NOT EXISTS check.
--
-- 'discover' jobs target a source; 'process' jobs target an episode — never
-- both, so each job has exactly one of the two FK columns set.
--
-- Also renames scheduler_paused -> processing_paused. Pausing no longer
-- pauses the APScheduler instance itself (that stopped the discovery cron
-- and the stuck-job reclaim sweep as an unrelated side effect); it now only
-- gates whether a 'process' job can be claimed by a worker. See
-- /worker/jobs/next in main.py.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS source_id  UUID REFERENCES sources(id)  ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES episodes(id) ON DELETE SET NULL;

-- Only backfill where the target still exists — a completed/failed job whose
-- source or episode has since been deleted should end up NULL here anyway
-- (that's the same outcome ON DELETE SET NULL would produce going forward);
-- the payload keeps the original id as the permanent record regardless.
--
-- The `~ uuid-pattern` check guards the ::uuid cast itself: IS NOT NULL alone
-- doesn't rule out a non-null value that isn't a well-formed UUID (a stray
-- value from an older/inconsistent payload shape), and a single bad row would
-- otherwise abort this entire statement with "invalid input syntax for type
-- uuid" instead of just being skipped.
UPDATE jobs SET source_id = (payload->>'source_id')::uuid
    WHERE kind = 'discover' AND source_id IS NULL
      AND payload->>'source_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND EXISTS (SELECT 1 FROM sources WHERE id = (payload->>'source_id')::uuid);
UPDATE jobs SET episode_id = (payload->>'episode_id')::uuid
    WHERE kind = 'process' AND episode_id IS NULL
      AND payload->>'episode_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND EXISTS (SELECT 1 FROM episodes WHERE id = (payload->>'episode_id')::uuid);

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_target_matches_kind;
ALTER TABLE jobs ADD CONSTRAINT jobs_target_matches_kind CHECK (
    (kind = 'discover' AND episode_id IS NULL) OR
    (kind = 'process'  AND source_id  IS NULL)
);

-- Defensive cleanup before the unique indexes below: if duplicate active jobs
-- for the same target already exist (the exact race this migration closes
-- off), keep one and fail the rest so index creation doesn't fail on existing
-- data. Prefer keeping a 'claimed' job over a 'pending' one first — a claimed
-- job may be actively being worked on by blurb right now, and failing it here
-- would throw away in-progress work for no reason when the redundant, not-yet-
-- started 'pending' duplicate is the safe one to drop instead.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY kind, COALESCE(episode_id, source_id)
               ORDER BY (status = 'claimed') DESC, created_at DESC
           ) AS rn
    FROM jobs
    WHERE status IN ('pending', 'claimed') AND COALESCE(episode_id, source_id) IS NOT NULL
)
UPDATE jobs SET status = 'failed', error = 'Superseded by a duplicate job for the same target (pre-constraint cleanup)'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_process_per_episode
    ON jobs (episode_id) WHERE kind = 'process' AND status IN ('pending', 'claimed');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_discover_per_source
    ON jobs (source_id) WHERE kind = 'discover' AND status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_jobs_episode_id ON jobs (episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_source_id  ON jobs (source_id)  WHERE source_id  IS NOT NULL;

UPDATE settings SET key = 'processing_paused' WHERE key = 'scheduler_paused';
