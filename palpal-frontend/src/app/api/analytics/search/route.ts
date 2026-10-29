import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { verifyAdminToken } from '@/lib/auth';
import { checkRateLimit, getClientIp, sanitizeInput } from '@/lib/validation';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL;
const ADMIN_KEY = process.env.CONDUCTOR_ADMIN_KEY;

const searchEventSchema = z.object({
  query: z.string().min(1).max(500),
  result_count: z.number().int().min(0).max(1_000_000_000),
  podcast_filter: z.string().max(100).nullable().optional().default(null),
  top_podcast_ids: z.array(z.string().max(100)).max(10).optional().default([]),
  corrected: z.boolean().optional().default(false),
});

function noContent(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get('host')) return false;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;

  return true;
}

export async function POST(request: NextRequest) {
  // Accurate counts matter less than not collecting from people who asked us
  // not to. GPC/DNT are also checked client-side; this is defense in depth.
  if (
    request.headers.get('sec-gpc') === '1' ||
    request.headers.get('dnt') === '1' ||
    !isSameOrigin(request)
  ) {
    return noContent();
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`analytics:search:${ip}`, 60, 60_000)) {
    return noContent();
  }

  // Don't count the operator's own searches from an authenticated admin tab.
  const session = (await cookies()).get('palpal_admin_session');
  if (session && (await verifyAdminToken(session.value))) {
    return noContent();
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 4096) return noContent();

  let parsed;
  try {
    parsed = searchEventSchema.safeParse(JSON.parse(await request.text()));
  } catch {
    return noContent();
  }
  if (!parsed.success) return noContent();

  const query = sanitizeInput(parsed.data.query);
  if (!query) return noContent();

  if (!CONDUCTOR_URL || !ADMIN_KEY) return noContent();

  try {
    await fetch(`${CONDUCTOR_URL}/analytics/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip,
      },
      body: JSON.stringify({
        query,
        result_count: parsed.data.result_count,
        podcast_filter: parsed.data.podcast_filter || null,
        top_podcast_ids: parsed.data.top_podcast_ids,
        corrected: parsed.data.corrected,
      }),
      cache: 'no-store',
    });
  } catch {
    // Analytics failures must not affect search.
  }

  return noContent();
}
