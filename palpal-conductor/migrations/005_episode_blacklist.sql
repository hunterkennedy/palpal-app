-- Migration: add blacklisted flag to episodes
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_episodes_blacklisted ON episodes(blacklisted) WHERE blacklisted = TRUE;
