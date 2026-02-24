import { NextRequest, NextResponse } from 'next/server';
import { searchTranscripts, searchMultiplePodcasts } from '@/lib/meilisearch';
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
  const rawIndexes = searchParams.get('indexes');
  const rawSort = searchParams.get('sort');
  const rawSortDirection = searchParams.get('sortDirection');
  const rawDateRange = searchParams.get('dateRange');
  const rawStartDate = searchParams.get('startDate');
  const rawEndDate = searchParams.get('endDate');
  const rawFilter = searchParams.get('filter');

  try {
    // Validate and sanitize input
    const validated = searchSchema.parse({
      q: rawQuery ? sanitizeInput(rawQuery) : '',
      limit: rawLimit ? parseInt(rawLimit) : 10
    });

    const { q: query, limit } = validated;

    // Parse indexes parameter
    let indexNames: string[] = [];
    if (rawIndexes) {
      try {
        indexNames = JSON.parse(rawIndexes);
        // Validate that it's an array of strings
        if (!Array.isArray(indexNames) || !indexNames.every(name => typeof name === 'string')) {
          throw new Error('Invalid indexes format');
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        return NextResponse.json(
          { error: 'Invalid indexes parameter. Must be a JSON array of strings.' },
          { status: 400 }
        );
      }
    } else {
      // Default to 'pal' index if no indexes specified
      indexNames = ['pal'];
    }

    // Parse sort and date parameters
    const sortBy = rawSort || 'relevance';
    const sortDirection = rawSortDirection || 'desc';
    const dateRange = rawDateRange || 'all';

    // Build date filter based on range
    let dateFilter: string | undefined;
    if (dateRange !== 'all') {
      const now = new Date();
      let startDate: Date | undefined;

      switch (dateRange) {
        case 'last_week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'last_month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'last_3_months':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'last_year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case 'custom':
          if (rawStartDate && rawEndDate) {
            const customStart = new Date(rawStartDate);
            const customEnd = new Date(rawEndDate);
            // Use ISO string format since publication_date is stored as ISO string
            dateFilter = `publication_date >= "${customStart.toISOString()}" AND publication_date <= "${customEnd.toISOString()}"`;
          }
          break;
        default:
          startDate = new Date(0); // Fallback to epoch
      }

      if (dateRange !== 'custom' && startDate) {
        // Use ISO string format since publication_date is stored as ISO string
        dateFilter = `publication_date >= "${startDate.toISOString()}"`;
      }
    }

    // Combine date filter with custom filter from query parameter
    let combinedFilter: string | undefined;
    if (dateFilter && rawFilter) {
      combinedFilter = `(${dateFilter}) AND (${rawFilter})`;
    } else if (dateFilter) {
      combinedFilter = dateFilter;
    } else if (rawFilter) {
      combinedFilter = rawFilter;
    }

    // Use multi-search if multiple indexes, single search if one
    const results = indexNames.length > 1
      ? await searchMultiplePodcasts(query, indexNames, limit, sortBy, sortDirection, combinedFilter)
      : await searchTranscripts(query, limit, indexNames[0], sortBy, sortDirection, combinedFilter);
    
    return NextResponse.json(results, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
        'Content-Type': 'application/json'
      }
    });
    
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