-- Migration 034: YouTube/Patreon session cookies now live only on blurb's
-- local disk and are never sent to or stored by conductor. Delete any
-- values left over from the old admin-panel cookie fields.

DELETE FROM settings WHERE key IN ('youtube_cookies', 'patreon_cookies');
