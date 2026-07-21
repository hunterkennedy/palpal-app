import { NextRequest, NextResponse } from 'next/server';
import { searchChunks } from '@/lib/conductor';
import { searchSchema, checkRateLimit, sanitizeInput, getClientIp } from '@/lib/validation';
import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Convert the UI's dateRange enum (+ custom start/end) into a date_from/date_to
 * pair the conductor's /search endpoint can filter on. Unknown/'all' values
 * apply no filter. */
function computeDateBounds(
  dateRange: string | null,
  startDate: string | null,
  endDate: string | null
): { date_from?: string; date_to?: string } {
  if (dateRange === 'custom') {
    return {
      date_from: startDate && ISO_DATE_RE.test(startDate) ? startDate : undefined,
      date_to: endDate && ISO_DATE_RE.test(endDate) ? endDate : undefined,
    };
  }

  const from = new Date();
  switch (dateRange) {
    case 'last_week':
      from.setUTCDate(from.getUTCDate() - 7);
      break;
    case 'last_month':
      from.setUTCMonth(from.getUTCMonth() - 1);
      break;
    case 'last_3_months':
      from.setUTCMonth(from.getUTCMonth() - 3);
      break;
    case 'last_year':
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      break;
    default:
      return {};
  }
  return { date_from: from.toISOString().slice(0, 10) };
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const rawQuery = searchParams.get('q');
  const rawLimit = searchParams.get('limit');
  const rawPodcastId = searchParams.get('podcast_id');
  const rawPage = searchParams.get('page');
  const rawDateRange = searchParams.get('dateRange');
  const rawStartDate = searchParams.get('startDate');
  const rawEndDate = searchParams.get('endDate');

  try {
    const validated = searchSchema.parse({
      q: rawQuery ? sanitizeInput(rawQuery) : '',
      limit: rawLimit ? parseInt(rawLimit) : 20
    });

    const { q: query, limit } = validated;

    const parsedPage = rawPage ? parseInt(rawPage, 10) : 1;
    const page = Number.isFinite(parsedPage) ? Math.min(Math.max(parsedPage, 1), 1000) : 1;

    const { date_from, date_to } = computeDateBounds(rawDateRange, rawStartDate, rawEndDate);

    const conductorResult = await searchChunks({
      q: query,
      podcast_id: rawPodcastId || undefined,
      page,
      page_size: limit,
      date_from,
      date_to,
    }, ip);

    // Normalize to the shape page.tsx already expects
    return NextResponse.json(
      {
        hits: conductorResult.results,
        estimatedTotalHits: conductorResult.total,
        correctedQuery: conductorResult.corrected_query ?? null,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input parameters',
          details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
        },
        { status: 400 }
      );
    }

    console.error('Search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error. Please try again later.' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');

  // No origin header means a non-browser request — no CORS response needed
  if (!origin) {
    return new NextResponse(null, { status: 204 });
  }

  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? [])
    : ['http://localhost:3000', 'http://localhost:3001'];

  const isAllowedOrigin = allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}
