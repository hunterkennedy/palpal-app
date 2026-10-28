-- Migration 044: separate processing priority from public display order.
--
-- display_order controls how podcasts appear in the public app. priority
-- controls dispatch order in the internal process queue: higher priority
-- podcasts are queued first without changing the public ordering.

ALTER TABLE podcasts
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_podcasts_priority
    ON podcasts (priority DESC, display_order);
