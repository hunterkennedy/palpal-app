-- Migration 016: drop audio_path column
-- Audio path is now passed in-memory through the pipeline; no longer persisted.

ALTER TABLE episodes DROP COLUMN IF EXISTS audio_path;
