-- Migration 045: privacy-preserving search analytics.
--
-- Everything here is aggregate-only. There are deliberately no event-level
-- rows, no IP addresses, no user/session IDs, and no query-to-click linkage.
-- Unique searchers are counted in conductor's memory using a daily secret and
-- only the resulting daily number is persisted.
--
-- Days are bucketed in America/Los_Angeles by the application; the DATE columns
-- therefore represent the Pacific calendar day, not a UTC day.

CREATE TABLE IF NOT EXISTS analytics_search_daily (
    day                  DATE        PRIMARY KEY,
    searches             BIGINT      NOT NULL DEFAULT 0,
    zero_result_searches BIGINT      NOT NULL DEFAULT 0,
    corrected_searches   BIGINT      NOT NULL DEFAULT 0,
    unique_searchers     INTEGER     NOT NULL DEFAULT 0,
    opens                BIGINT      NOT NULL DEFAULT 0,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_query_daily (
    day                  DATE   NOT NULL,
    query                TEXT   NOT NULL,
    searches             BIGINT NOT NULL DEFAULT 0,
    zero_result_searches BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, query)
);

CREATE INDEX IF NOT EXISTS idx_analytics_query_daily_query
    ON analytics_query_daily (query);
CREATE INDEX IF NOT EXISTS idx_analytics_query_daily_day
    ON analytics_query_daily (day DESC);

CREATE TABLE IF NOT EXISTS analytics_podcast_daily (
    day               DATE   NOT NULL,
    podcast_id        TEXT   NOT NULL,
    impressions       BIGINT NOT NULL DEFAULT 0,
    filtered_searches BIGINT NOT NULL DEFAULT 0,
    opens             BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, podcast_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_podcast_daily_day
    ON analytics_podcast_daily (day DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_podcast_daily_podcast
    ON analytics_podcast_daily (podcast_id);

CREATE TABLE IF NOT EXISTS analytics_clip_daily (
    day         DATE   NOT NULL,
    chunk_id    UUID   NOT NULL,
    episode_id  UUID,
    podcast_id  TEXT   NOT NULL,
    source_site TEXT,
    opens       BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_clip_daily_day
    ON analytics_clip_daily (day DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_clip_daily_podcast
    ON analytics_clip_daily (podcast_id);
CREATE INDEX IF NOT EXISTS idx_analytics_clip_daily_chunk
    ON analytics_clip_daily (chunk_id);

-- Settings are exposed through the existing admin pipeline-settings endpoint.
-- Collection is opt-in: analytics_enabled starts false and must be turned on
-- after the privacy policy covering it is live. Query text is retained for 180
-- days; identifier-free aggregates for 2 years.
INSERT INTO settings (key, value) VALUES
    ('analytics_enabled',                  'false'),
    ('analytics_store_queries',            'true'),
    ('analytics_query_retention_days',     '180'),
    ('analytics_aggregate_retention_days', '730')
ON CONFLICT (key) DO NOTHING;
