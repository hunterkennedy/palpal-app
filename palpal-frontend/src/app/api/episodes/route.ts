import { NextResponse } from 'next/server';
import { getEpisodes } from '@/lib/conductor';

export async function GET() {
  try {
    const episodes = await getEpisodes();
    return NextResponse.json(episodes, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('Episodes API error:', err);
    return NextResponse.json({ error: 'Failed to fetch episodes' }, { status: 502 });
  }
}
