import { NextRequest, NextResponse } from 'next/server';
import { getChunks } from '@/lib/conductor';
import { checkRateLimit } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'anonymous';
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
    const chunks = await getChunks(chunkId, radius);

    // Derive hasMoreBefore/hasMoreAfter from the returned set.
    // Conductor returns chunks in range [centerIndex - radius, centerIndex + radius].
    // If the first chunk has chunk_index > 0, there are more before.
    // We can't know the episode total, so hasMoreAfter is always true unless radius
    // returned fewer chunks than expected on the after side — approximate via chunk_index=0 check.
    const hasMoreBefore = chunks.length > 0 && chunks[0].chunk_index > 0;
    // For after: if we got at least one chunk after the center, assume more may exist.
    // The center chunk is the one matching chunkId; without it readily identified,
    // we conservatively set hasMoreAfter=true when any chunks were returned.
    const hasMoreAfter = chunks.length > 0;

    return NextResponse.json({ chunks, hasMoreBefore, hasMoreAfter });
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
