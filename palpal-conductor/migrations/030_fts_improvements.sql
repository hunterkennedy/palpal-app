-- FTS improvements:
--   1. Trigger drops podcast_name from search_vector (redundant; filtered by podcast_id instead)
--   2. Rebuild all existing search vectors

CREATE OR REPLACE FUNCTION update_chunk_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.text, '')),          'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.episode_title, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_chunk_search_vector ON transcript_chunks;
CREATE TRIGGER trig_chunk_search_vector
    BEFORE INSERT OR UPDATE OF text, episode_title
    ON transcript_chunks
    FOR EACH ROW EXECUTE FUNCTION update_chunk_search_vector();

-- Rebuild all existing vectors with the new definition
UPDATE transcript_chunks
SET search_vector =
    setweight(to_tsvector('english', COALESCE(text, '')),          'A') ||
    setweight(to_tsvector('english', COALESCE(episode_title, '')), 'B');
