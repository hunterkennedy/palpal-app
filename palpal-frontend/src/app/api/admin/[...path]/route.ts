import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/session';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;
const ADMIN_KEY     = process.env.CONDUCTOR_ADMIN_KEY!;
async function proxy(request: NextRequest, path: string[]) {
  const session = (await cookies()).get('palpal_admin_session');
  if (!session || !verifySessionToken(session.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const qs = request.nextUrl.search;
  const upstream = `${CONDUCTOR_URL}/admin/${path.join('/')}${qs}`;

  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await request.text();

  const res = await fetch(upstream, {
    method: request.method,
    headers: {
      'Authorization': `Bearer ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
    cache: 'no-store',
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
