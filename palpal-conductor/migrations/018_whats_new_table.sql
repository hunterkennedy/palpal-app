CREATE TABLE whats_new (
  id        SERIAL PRIMARY KEY,
  content   TEXT        NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate existing entry from settings if present
INSERT INTO whats_new (content, posted_at)
SELECT
  s_content.value,
  COALESCE(
    NULLIF(s_date.value, '')::timestamptz,
    NOW()
  )
FROM settings s_content
LEFT JOIN settings s_date ON s_date.key = 'whats_new_date'
WHERE s_content.key = 'whats_new_content'
  AND s_content.value != '';

-- Clean up old settings keys
DELETE FROM settings WHERE key IN ('whats_new_content', 'whats_new_date');
