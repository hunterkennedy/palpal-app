import { NextRequest, NextResponse } from 'next/server';

function getConductorUrl(): string {
  const url = process.env.CONDUCTOR_URL;
  if (!url) throw new Error('CONDUCTOR_URL not set');
  return url;
}

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';
  try {
    const res = await fetch(`${getConductorUrl()}/search-placeholders`, {
      ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 86400 } }), // 24h upstream cache
    });
    if (!res.ok) throw new Error();
    return NextResponse.json(await res.json(), {
      headers: fresh
        ? { 'Cache-Control': 'no-store' }
        : {
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
          },
    });
  } catch {
    return NextResponse.json([]);
  }
}
