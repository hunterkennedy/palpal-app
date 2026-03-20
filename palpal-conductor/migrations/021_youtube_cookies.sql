INSERT INTO settings (key, value)
VALUES ('youtube_cookies', '')
ON CONFLICT (key) DO NOTHING;
