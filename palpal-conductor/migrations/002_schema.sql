-- PODCASTS
CREATE TABLE IF NOT EXISTS podcasts (
    id              TEXT        PRIMARY KEY,
    display_name    TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    image           TEXT        NOT NULL DEFAULT '',
    social_sections JSONB       NOT NULL DEFAULT '[]',
    enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
    display_order   INTEGER     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SOURCES
CREATE TABLE IF NOT EXISTS sources (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    podcast_id  TEXT        NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    site        TEXT        NOT NULL,
    type        TEXT        NOT NULL,
    url         TEXT        NOT NULL,
    fetch_url   TEXT,
    description TEXT,
    filters     JSONB       NOT NULL DEFAULT '{}',
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_podcast_id ON sources(podcast_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_podcast_name ON sources(podcast_id, name);

-- EPISODES
CREATE TABLE IF NOT EXISTS episodes (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id        UUID        NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    video_id         TEXT        NOT NULL,
    title            TEXT        NOT NULL DEFAULT '',
    publication_date DATE,
    audio_path       TEXT,
    status           TEXT        NOT NULL DEFAULT 'discovered'
                     CHECK (status IN ('discovered','downloading','downloaded','transcribing','processed','failed')),
    error_message    TEXT,
    blacklisted      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_source_video ON episodes(source_id, video_id);
CREATE INDEX IF NOT EXISTS idx_episodes_source_id  ON episodes(source_id);
CREATE INDEX IF NOT EXISTS idx_episodes_pub_date   ON episodes(publication_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_episodes_video_id   ON episodes(video_id);
CREATE INDEX IF NOT EXISTS idx_episodes_status     ON episodes(status);
CREATE INDEX IF NOT EXISTS idx_episodes_blacklisted ON episodes(blacklisted) WHERE blacklisted = TRUE;

-- RAW TRANSCRIPTS
CREATE TABLE IF NOT EXISTS transcripts (
    episode_id  UUID        PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    language    TEXT,
    segments    JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TRANSCRIPT CHUNKS
CREATE TABLE IF NOT EXISTS transcript_chunks (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id       UUID          NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    text             TEXT          NOT NULL,
    word_count       INTEGER       NOT NULL DEFAULT 0,
    chunk_index      INTEGER       NOT NULL,
    start_time       NUMERIC(10,3) NOT NULL,
    end_time         NUMERIC(10,3) NOT NULL,
    duration         NUMERIC(10,3) NOT NULL,
    start_formatted  TEXT          NOT NULL DEFAULT '',
    end_formatted    TEXT          NOT NULL DEFAULT '',
    start_minutes    NUMERIC(8,2)  NOT NULL DEFAULT 0,
    podcast_id       TEXT          NOT NULL,
    podcast_name     TEXT          NOT NULL DEFAULT '',
    source_name      TEXT          NOT NULL DEFAULT '',
    episode_title    TEXT          NOT NULL DEFAULT '',
    video_id         TEXT          NOT NULL DEFAULT '',
    publication_date DATE,
    search_vector    TSVECTOR,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_search_vector  ON transcript_chunks USING GIN(search_vector);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_episode_chunk ON transcript_chunks(episode_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_pub_date       ON transcript_chunks(publication_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chunks_duration       ON transcript_chunks(duration DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_podcast_pub    ON transcript_chunks(podcast_id, publication_date DESC NULLS LAST);

-- FTS TRIGGER
CREATE OR REPLACE FUNCTION update_chunk_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.text, '')),          'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.episode_title, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.podcast_name, '')),  'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_chunk_search_vector ON transcript_chunks;
CREATE TRIGGER trig_chunk_search_vector
    BEFORE INSERT OR UPDATE OF text, episode_title, podcast_name
    ON transcript_chunks
    FOR EACH ROW EXECUTE FUNCTION update_chunk_search_vector();

-- UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_podcasts_updated_at ON podcasts;
CREATE TRIGGER trig_podcasts_updated_at
    BEFORE UPDATE ON podcasts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trig_sources_updated_at ON sources;
CREATE TRIGGER trig_sources_updated_at
    BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trig_episodes_updated_at ON episodes;
CREATE TRIGGER trig_episodes_updated_at
    BEFORE UPDATE ON episodes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- PIPELINE SETTINGS
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
