import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';
  try {
    const res = await fetch(`${CONDUCTOR_URL}/whats-new`, {
      ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
    });
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json(), {
      headers: fresh ? { 'Cache-Control': 'no-store' } : undefined,
    });
  } catch {
    return NextResponse.json([]);
  }
}
