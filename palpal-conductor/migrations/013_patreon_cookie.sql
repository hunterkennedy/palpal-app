INSERT INTO settings (key, value)
VALUES ('patreon_session_cookie', '')
ON CONFLICT (key) DO NOTHING;
