-- Migration 025: drop unused description columns
ALTER TABLE podcasts DROP COLUMN IF EXISTS description;
ALTER TABLE sources  DROP COLUMN IF EXISTS description;
