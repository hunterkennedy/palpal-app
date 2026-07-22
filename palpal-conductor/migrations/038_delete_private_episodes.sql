-- Migration 038: private videos have no title and were never fetchable, but
-- before discovery started skipping them (empty-title entries), they got
-- inserted and dispatched like any other episode. A leftover blank-title row
-- can be sitting in any status — 'failed' (already tried and died),
-- 'discovered' (never yet dispatched), 'downloading' (a job in flight right
-- now), or 'blacklisted' — and every one of them is equally unfetchable, so
-- clean up all of them to match current discovery behavior of never
-- inserting them in the first place.

-- Cancel any live job first. jobs.episode_id is ON DELETE SET NULL, not
-- CASCADE (see migration 037), so the DELETE below alone would leave a
-- pending/claimed process job pointing at an episode_id that no longer
-- resolves to anything — blurb would still pick it up and waste a download
-- attempt on nothing before the stale-complete guard discards the result.
UPDATE jobs SET status = 'failed', error = 'Cancelled: episode deleted (blank title, unfetchable)'
WHERE kind = 'process' AND status IN ('pending', 'claimed')
  AND episode_id IN (
      SELECT id FROM episodes WHERE title IS NULL OR title = ''
  );

DELETE FROM episodes
WHERE title IS NULL OR title = '';
