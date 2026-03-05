-- Migration: add blacklisted flag to episodes
-- Blacklisted episodes are kept in the DB (to prevent re-discovery) but
-- skipped by automatic pipeline processing and the stuck-episode recovery job.
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_episodes_blacklisted ON episodes(blacklisted) WHERE blacklisted = TRUE;
