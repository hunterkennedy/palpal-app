-- Add 'blacklisted' as a valid episode status value and migrate existing records.

-- Drop old CHECK constraint (named inline in 002_schema.sql)
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;

-- Re-add with 'blacklisted' included
ALTER TABLE episodes
    ADD CONSTRAINT episodes_status_check
    CHECK (status IN ('discovered','downloading','downloaded','transcribing','processed','failed','blacklisted'));

-- Migrate existing blacklisted episodes to use the new status
UPDATE episodes
SET status = 'blacklisted'
WHERE blacklisted = TRUE
  AND status = 'discovered';
