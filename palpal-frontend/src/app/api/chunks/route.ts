import { NextRequest, NextResponse } from 'next/server';
import { getChunks } from '@/lib/conductor';
import { checkRateLimit, getClientIp } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  const searchParams = request.nextUrl.searchParams;
  const chunkId = searchParams.get('chunkId');
  const radiusParam = searchParams.get('radius');

  if (!chunkId) {
    return NextResponse.json({ error: 'chunkId is required' }, { status: 400 });
  }

  const radius = radiusParam ? parseInt(radiusParam) : 2;

  try {
    const { chunks, has_more_before, has_more_after } = await getChunks(chunkId, radius);
    return NextResponse.json({ chunks, hasMoreBefore: has_more_before, hasMoreAfter: has_more_after });
  } catch (error) {
    console.error('Chunks API error:', error);
    return NextResponse.json({ error: 'Failed to fetch chunks' }, { status: 500 });
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
