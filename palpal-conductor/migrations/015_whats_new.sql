INSERT INTO settings (key, value)
VALUES ('whats_new_content', ''), ('whats_new_date', '')
ON CONFLICT (key) DO NOTHING;
