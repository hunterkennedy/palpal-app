INSERT INTO settings (key, value)
VALUES ('chunk_target_words', '50')
ON CONFLICT (key) DO NOTHING;
