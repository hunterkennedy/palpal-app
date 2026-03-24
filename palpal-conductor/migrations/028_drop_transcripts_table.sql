-- Drop the transcripts table now that raw transcript data lives in B2.
-- Only apply this after running scripts/migrate_transcripts_to_b2.py
-- and verifying that all transcripts are accessible in B2.
DROP TABLE IF EXISTS transcripts;
