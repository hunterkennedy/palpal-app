/**
 * Proxy for conductor admin endpoints.
 * Forwards GET/POST requests to /admin/... on conductor with the admin key.
 * NOTE: This route is publicly reachable. Security relies on CONDUCTOR_ADMIN_KEY
 * being forwarded to conductor. Consider adding session-based auth here.
 */
import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL || 'http://localhost:8000';
const ADMIN_KEY = process.env.CONDUCTOR_ADMIN_KEY;

async function proxy(request: NextRequest, path: string[]) {
  const endpoint = path.join('/');
  const targetUrl = new URL(`${CONDUCTOR_URL}/admin/${endpoint}`);

  // Forward query params
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (ADMIN_KEY) headers['Authorization'] = `Bearer ${ADMIN_KEY}`;

  const init: RequestInit = { method: request.method, headers };
  if (request.method === 'POST') {
    const text = await request.text();
    if (text) init.body = text;
  }

  try {
    const res = await fetch(targetUrl.toString(), init);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('Admin proxy error:', err);
    return NextResponse.json({ error: 'Failed to reach conductor' }, { status: 502 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}
