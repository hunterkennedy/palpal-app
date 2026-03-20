import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/whats-new`, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([]);
  }
}
