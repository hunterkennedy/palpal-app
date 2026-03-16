import { NextRequest, NextResponse } from 'next/server';
import { searchChunks } from '@/lib/conductor';
import { searchSchema, checkRateLimit, sanitizeInput } from '@/lib/validation';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'anonymous';
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
  const rawSort = searchParams.get('sort');
  const rawDateRange = searchParams.get('dateRange');
  const rawStartDate = searchParams.get('startDate');
  const rawEndDate = searchParams.get('endDate');
  const rawPage = searchParams.get('page');

  try {
    const validated = searchSchema.parse({
      q: rawQuery ? sanitizeInput(rawQuery) : '',
      limit: rawLimit ? parseInt(rawLimit) : 20
    });

    const { q: query, limit } = validated;

    // Map conductor sort values (date/duration)
    const sortBy = rawSort || 'date';
    const conductorSort = ['date', 'duration'].includes(sortBy) ? sortBy : 'date';

    // Compute date_from / date_to from date range preset or custom dates
    let date_from: string | undefined;
    let date_to: string | undefined;

    const dateRange = rawDateRange || 'all';
    if (dateRange !== 'all') {
      const now = new Date();
      switch (dateRange) {
        case 'last_week':
          date_from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          break;
        case 'last_month':
          date_from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          break;
        case 'last_3_months':
          date_from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          break;
        case 'last_year':
          date_from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          break;
        case 'custom':
          if (rawStartDate) date_from = new Date(rawStartDate).toISOString().slice(0, 10);
          if (rawEndDate) date_to = new Date(rawEndDate).toISOString().slice(0, 10);
          break;
      }
    }

    const parsedPage = rawPage ? parseInt(rawPage, 10) : 1;
    const page = Number.isFinite(parsedPage) ? Math.min(Math.max(parsedPage, 1), 1000) : 1;

    const conductorResult = await searchChunks({
      q: query,
      podcast_id: rawPodcastId || undefined,
      sort: conductorSort,
      date_from,
      date_to,
      page,
      page_size: limit,
    });

    // Normalize to the shape page.tsx already expects
    return NextResponse.json(
      {
        hits: conductorResult.results,
        estimatedTotalHits: conductorResult.total,
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
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.ALLOWED_ORIGINS?.split(',') || []].flat()
    : ['http://localhost:3000', 'http://localhost:3001'];

  const isAllowedOrigin = !origin || allowedOrigins.includes(origin);

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': isAllowedOrigin ? (origin || '*') : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}
