import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/auth';
import { checkAdminRateLimit, rateLimitHeaders } from '@/lib/adminRateLimit';
import { getClientIp } from '@/lib/validation';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;
const ADMIN_KEY     = process.env.CONDUCTOR_ADMIN_KEY!;

async function proxy(request: NextRequest, path: string[]) {
  const isWrite = !['GET', 'HEAD'].includes(request.method);
  const limitKey = `admin:${isWrite ? 'write' : 'read'}:${getClientIp(request)}`;
  const limit = checkAdminRateLimit(limitKey, isWrite ? 60 : 600, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many admin requests', retry_after: limit.retryAfterSeconds },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  const session = (await cookies()).get('palpal_admin_session');
  if (!session || !(await verifyAdminToken(session.value))) {
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
  const disposition = res.headers.get('Content-Disposition');
  return new NextResponse(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      ...(disposition ? { 'Content-Disposition': disposition } : {}),
      ...rateLimitHeaders(limit),
    },
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
