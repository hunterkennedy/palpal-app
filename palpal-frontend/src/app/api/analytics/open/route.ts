import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { verifyAdminToken } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/validation';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL;
const ADMIN_KEY = process.env.CONDUCTOR_ADMIN_KEY;

const openEventSchema = z.object({
  podcast_id: z.string().min(1).max(100),
  episode_id: z.string().uuid().nullable().optional().default(null),
  chunk_id: z.string().uuid().nullable().optional().default(null),
  source_site: z.string().max(50).nullable().optional().default(null),
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
  if (
    request.headers.get('sec-gpc') === '1' ||
    request.headers.get('dnt') === '1' ||
    !isSameOrigin(request)
  ) {
    return noContent();
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`analytics:open:${ip}`, 120, 60_000)) {
    return noContent();
  }

  const session = (await cookies()).get('palpal_admin_session');
  if (session && (await verifyAdminToken(session.value))) {
    return noContent();
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 2048) return noContent();

  let parsed;
  try {
    parsed = openEventSchema.safeParse(JSON.parse(await request.text()));
  } catch {
    return noContent();
  }
  if (!parsed.success) return noContent();

  if (!CONDUCTOR_URL || !ADMIN_KEY) return noContent();

  try {
    const res = await fetch(`${CONDUCTOR_URL}/analytics/open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
    if (!res.ok) {
      // Status only: never log the request body.
      console.warn('Analytics open ingest failed', res.status);
    }
  } catch {
    console.warn('Analytics open ingest request failed');
  }

  return noContent();
}
