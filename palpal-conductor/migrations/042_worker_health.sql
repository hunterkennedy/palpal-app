-- Migration 042: non-secret worker health on heartbeats.
--
-- Cookie files, yt-dlp version, model/device, and GPU information live only on
-- blurb's machine. Conductor stores the worker-reported summary so the admin
-- console can warn before cookies expire and show what hardware/config is
-- actually serving jobs.

ALTER TABLE worker_heartbeats
    ADD COLUMN IF NOT EXISTS health JSONB NOT NULL DEFAULT '{}'::jsonb;
