import { NextResponse } from 'next/server';

function getConductorUrl(): string {
  const url = process.env.CONDUCTOR_URL;
  if (!url) throw new Error('CONDUCTOR_URL not set');
  return url;
}

export async function GET() {
  try {
    const res = await fetch(`${getConductorUrl()}/search-placeholders`, {
      next: { revalidate: 86400 }, // 24h upstream cache
    });
    if (!res.ok) throw new Error();
    return NextResponse.json(await res.json(), {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      },
    });
  } catch {
    return NextResponse.json([]);
  }
}
