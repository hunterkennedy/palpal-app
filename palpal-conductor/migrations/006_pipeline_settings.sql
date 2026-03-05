-- Migration: pipeline auto-progression settings
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
    ('auto_discover',   'true'),
    ('auto_download',   'true'),
    ('auto_transcribe', 'true')
ON CONFLICT (key) DO NOTHING;
