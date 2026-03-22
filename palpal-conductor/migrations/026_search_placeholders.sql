-- Migration 026: seed default search bar placeholder texts
INSERT INTO settings (key, value)
VALUES ('search_placeholders', '["there''s multiple...", "it goes kuru...", "the very limit of a molecule...", "even a peppermint...", "making life beautiful...", "fortnite..."]')
ON CONFLICT (key) DO NOTHING;
