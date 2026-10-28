/**
 * Small fixed-window rate limiter for the admin surface.
 *
 * The admin frontend runs as a single Node process, so an in-process Map is
 * adequate. Keys are namespaced by purpose and client IP. Entries are pruned
 * opportunistically so a stream of unique IPs cannot grow the map forever.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

function prune(now: number) {
  if (now - lastPrune < 5 * 60 * 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  lastPrune = now;
}

export function checkAdminRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  prune(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - 1),
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, maxRequests - existing.count);
  return {
    ok: existing.count <= maxRequests,
    limit: maxRequests,
    remaining,
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function resetAdminRateLimit(key: string): void {
  buckets.delete(key);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok ? {} : { 'Retry-After': String(result.retryAfterSeconds) }),
  };
}
