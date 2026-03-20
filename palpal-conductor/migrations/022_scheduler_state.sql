-- Migration: persist scheduler pause state and last-run timestamps across restarts
INSERT INTO settings (key, value) VALUES ('scheduler_paused', 'false')
ON CONFLICT (key) DO NOTHING;
