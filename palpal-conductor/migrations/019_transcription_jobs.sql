CREATE TABLE transcription_jobs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id  UUID        NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    audio_path  TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','claimed','completed','failed')),
    claimed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    result      JSONB,
    error       TEXT
);

CREATE INDEX ON transcription_jobs (status, created_at)
    WHERE status IN ('pending', 'claimed');
