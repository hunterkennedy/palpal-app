-- Migration: add 'downloaded' to episode status state machine
-- Run this once against any existing database.
-- New databases created from 002_schema.sql already include this value.
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered', 'downloading', 'downloaded', 'transcribing', 'processed', 'failed'));
