import { NextRequest, NextResponse } from 'next/server';
import { getAllStaticPodcastConfigs } from '@/lib/static-podcasts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const podcasts = getAllStaticPodcastConfigs();

    return NextResponse.json(podcasts, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Podcasts API error:', error);
    return NextResponse.json(
      { error: 'Failed to load podcast configurations' },
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