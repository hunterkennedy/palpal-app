import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';
  try {
    const res = await fetch(`${CONDUCTOR_URL}/whats-new`, {
      ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
    });
    if (!res.ok) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(await res.json(), {
      headers: fresh
        ? { 'Cache-Control': 'no-store' }
        : { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  }
}
