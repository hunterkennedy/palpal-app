-- Migration 038: private videos have no title and were never fetchable, but
-- before discovery started skipping them (empty-title entries) they got
-- inserted, dispatched, failed on blurb, and left behind as dead 'failed'
-- rows. Delete them to match the now-current behavior of never inserting
-- them in the first place.

DELETE FROM episodes
WHERE status = 'failed'
  AND (title IS NULL OR title = '');
