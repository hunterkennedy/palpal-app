# Frontend TODO

Generated from code review. Ordered by priority.

## Bugs

- [ ] **`page.tsx:257` — URL date range restoration broken**
  Values `['all', 'day', 'week', 'month', 'year', 'custom']` don't match actual `DateRange` type
  (`'last_week' | 'last_month' | 'last_3_months' | 'last_year' | 'custom'`).
  Date range is never restored when reloading or sharing a URL.

- [ ] **`SearchResults.tsx:104` — Copy-paste bug in save**
  `end_formatted: hit.start_formatted` should be `hit.end_formatted`.
  Saved chunks always store start time for both fields.

- [ ] **`page.tsx:362` — `sortDirection` unused in `performSearch`**
  It's in the dependency array but never passed to the API.
  Sort direction has no effect on search results.

## Security

- [ ] **`WhatsNewBubble.tsx:83` — `dangerouslySetInnerHTML` without DOMPurify**
  Content comes from the server filesystem today, but this is bad practice.
  Wrap with `DOMPurify.sanitize()` like everywhere else in the codebase.

- [ ] **`admin/[...path]/route.ts` — No auth guard on the Next.js proxy layer**
  Comment says "localhost-only" but this route is publicly reachable on the Next.js server.
  Only protection is the key forwarded to conductor. Add a key check at the proxy layer too,
  or at minimum remove the misleading comment.

- [ ] **`chunks/route.ts:40` — CORS wildcard**
  Uses `'Access-Control-Allow-Origin': '*'` instead of the `ALLOWED_ORIGINS` logic
  used by the search route.

- [ ] **`validation.ts:14` — Rate limit map never pruned**
  Module-level `rateLimitMap` accumulates every unique IP with no eviction.
  Add periodic cleanup or cap the map size.

## Code Quality

- [ ] **`page.tsx:467` — Remove debug `console.log`**
  `console.log('Custom date change received:', startDate, endDate)` left in production code.

- [ ] **`page.tsx:276–309` — Consolidate URL sync `useEffect`s**
  Five separate effects each calling `router.replace` on individual filter state.
  Causes multiple history entries on initial load. Consolidate into one effect.

- [ ] **`page.tsx:119` — Magic string `'pal'` in podcast comparison**
  `JSON.stringify(params.podcasts) !== JSON.stringify(['pal'])` is fragile.
  Derive the default from the actual podcast list.

- [ ] **`whats-new/route.ts:13` — Unnecessary dynamic import**
  `const { stat } = await import('fs/promises')` — `fs/promises` is already imported at the top.
  Add `stat` to the existing import.

- [ ] **`conductor.ts:88–90` — Silent auth bypass when `CONDUCTOR_ADMIN_KEY` is missing**
  Admin calls proceed without headers if the env var is unset.
  Should warn or throw so misconfiguration is visible at startup.

## Minor / Style

- [ ] **`page.tsx:183` — `window.pageYOffset` is deprecated** — use `window.scrollY`.

- [ ] **`WhatsNewBubble.tsx:71–72` — Inline `onMouseEnter`/`onMouseLeave` style toggling**
  Should use Tailwind hover classes instead.

- [ ] **`SearchFilters.tsx` — Audit `onePerEpisode` prop**
  This filter exists in `SearchFilters` but may not be wired to `page.tsx` state or the URL.
  Verify it's actually used or remove it.
