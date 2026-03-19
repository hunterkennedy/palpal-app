import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL;

export async function GET() {
  if (!CONDUCTOR_URL) {
    return NextResponse.json({ error: 'CONDUCTOR_URL not set' }, { status: 500 });
  }
  try {
    const res = await fetch(`${CONDUCTOR_URL}/whats-new`, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Conductor /whats-new: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('Whats-new fetch error:', err);
    return NextResponse.json({ content: '', date: '' });
  }
}
