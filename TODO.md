# Analytics launch TODO

Status: Phases 0–4 are implemented and tested locally. Nothing is pushed or deployed yet.

## Before pushing

- [ ] Add a What's New entry announcing search analytics and the opt-out control.
- [ ] Have the Privacy Policy reviewed by counsel/DPO, especially:
  - [ ] legitimate-interests basis and balancing test
  - [ ] Ionos/Cloudflare/Backblaze processor terms and transfer mechanism
  - [ ] whether an EU representative is required
  - [ ] the "no separate database backups" statement
- [ ] Write a short internal Legitimate Interests Assessment (LIA).
- [ ] Confirm whether Ionos takes VM snapshots or backups. If it does, update the policy before launch.
- [ ] Confirm DPAs are accepted with Ionos, Cloudflare, and Backblaze.
- [ ] Run one real browser smoke test:
  - [ ] search → `analytics_search_daily.searches` increments
  - [ ] click a search-result watch link → opens increment
  - [ ] click a context-view link → opens increment
  - [ ] click a Saved-page watch link → opens increment
  - [ ] open `/admin/analytics` → charts, queries, podcasts, and clips render
  - [ ] opt out on `/pp` → search again → no increment
  - [ ] opt back in → search again → increments resume
- [ ] Purge any local smoke-test analytics rows before announcing.

## Deploy

- [ ] Push the commits.
- [ ] Build and push versioned images (not only `latest`) so rollback is clean.
- [ ] Deploy conductor, frontend, and the Privacy Policy together.
- [ ] Confirm migration `045_search_analytics.sql` applied.
- [ ] Recreate containers so the new logging config takes effect.
- [ ] Clear/rotate old production logs that may contain historical search queries and IPs.
- [ ] Purge Cloudflare cache for `/pp` and the homepage after deploy.
- [ ] Verify `/api/admin/*` and `/api/worker/*` return `private, no-store`.
- [ ] Verify unique-searcher counting from two different networks/devices.
  - [ ] If counts stay at 1, make `getClientIp` prefer `CF-Connecting-IP`.
- [ ] Verify search and open events reach `analytics_*` tables.
- [ ] Verify the admin Analytics view and CSV exports.
- [ ] Verify the opt-out control and GPC/DNT suppression in production.

## After deploy

- [ ] Watch for `Analytics search/open ingest failed` warnings.
- [ ] Confirm analytics retention runs (query text 180 days, aggregates 730 days).
- [ ] Review zero-result queries after the first week for content/index gaps.
- [ ] Review podcasts with no opens over 30–90 days before removing anything.
- [ ] Tune the review-candidate impression threshold once there is real traffic.
- [ ] Update the policy if retention settings or backups change.
- [ ] Consider tracking saves/watchlist additions as a stronger interest signal.
- [ ] Consider the privacy exposure of search terms in URLs to Cloudflare/Ionos; a POST/session-only search flow would reduce it.
- [ ] Consider making the review-candidate threshold configurable.
- [ ] Consider adding a "data freshness" timestamp to the Analytics view.

## Known limitations

- Saved clips created before this change do not contain `podcast_id`, `episode_id`, or `site`, so their Saved-page opens are not tracked until the clip is saved again.
- Unique searchers are approximate daily counts; there is no cross-day unique-user count.
- Search terms appear in page/API URLs and are therefore visible to Cloudflare, Ionos, and browser history.

## Rollback

- [ ] Revert to the previous image tag/commit.
- [ ] Disable analytics in Settings and purge data if needed.
- [ ] Migration 045 is additive; the tables and settings can remain without affecting the reverted app.
