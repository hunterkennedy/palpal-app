-- Migration 036: track blurb worker liveness independent of job activity.
-- Job polling backs off up to 12h when idle, so "last claimed a job" is not
-- a reliable connectivity signal — blurb sends a lightweight heartbeat on a
-- short fixed interval instead (see /worker/heartbeat), and every other
-- worker-authenticated request touches it too.

CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id    TEXT        PRIMARY KEY,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
