import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;
const BLURB_API_KEY = process.env.BLURB_API_KEY!;

async function proxy(request: NextRequest, path: string[]) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || apiKey !== BLURB_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const qs = request.nextUrl.search;
  const upstream = `${CONDUCTOR_URL}/worker/${path.join('/')}${qs}`;

  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await request.arrayBuffer();

  const contentType = request.headers.get('Content-Type');
  const res = await fetch(upstream, {
    method: request.method,
    headers: {
      'X-API-Key': BLURB_API_KEY,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body: body ? body : undefined,
  });

  return new NextResponse(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
