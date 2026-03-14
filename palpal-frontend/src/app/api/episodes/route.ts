import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL;

export async function GET() {
  if (!CONDUCTOR_URL) {
    return NextResponse.json({ error: 'CONDUCTOR_URL not set' }, { status: 500 });
  }
  try {
    const res = await fetch(`${CONDUCTOR_URL}/episodes`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Conductor /episodes: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Episodes fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch episodes' }, { status: 502 });
  }
}
