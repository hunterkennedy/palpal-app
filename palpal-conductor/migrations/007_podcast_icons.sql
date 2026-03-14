ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS icon              BYTEA;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS icon_content_type TEXT;
