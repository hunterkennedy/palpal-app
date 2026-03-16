-- Store yt-dlp-reported duration on episodes for early filtering
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;

-- Minimum episode duration filter: episodes shorter than this are auto-blacklisted at discovery
-- Default: 1200s (20 minutes). Set to 0 to disable.
INSERT INTO settings (key, value)
VALUES ('min_episode_duration_seconds', '1200')
ON CONFLICT (key) DO NOTHING;
