-- Ensure pg_trgm is available (also declared in 001, but guarded here for safety)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Word frequency table for query spell-correction.
-- Populated from ts_stat() over the search_vector column — contains the stemmed
-- lexemes that are actually indexed, not raw words.
-- Refreshed by the conductor after each episode is processed.

CREATE TABLE IF NOT EXISTS word_frequencies (
    word    TEXT    PRIMARY KEY,
    ndoc    INTEGER NOT NULL DEFAULT 0,  -- number of chunks containing this word
    nentry  INTEGER NOT NULL DEFAULT 0   -- total occurrences across all chunks
);

CREATE INDEX IF NOT EXISTS idx_word_freq_trgm ON word_frequencies USING GIN(word gin_trgm_ops);

-- Populate on migration in case chunks already exist
INSERT INTO word_frequencies (word, ndoc, nentry)
SELECT word, ndoc, nentry FROM ts_stat('SELECT search_vector FROM transcript_chunks')
ON CONFLICT (word) DO UPDATE SET ndoc = EXCLUDED.ndoc, nentry = EXCLUDED.nentry;
