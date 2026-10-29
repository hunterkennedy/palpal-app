import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/auth';
import { checkAdminRateLimit, rateLimitHeaders } from '@/lib/adminRateLimit';
import { getClientIp } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;
const ADMIN_KEY = process.env.CONDUCTOR_ADMIN_KEY!;
const MAX_CONCURRENT_STREAMS = 20;

let activeStreams = 0;

export async function GET(request: NextRequest) {
  const connectionLimit = checkAdminRateLimit(
    `admin:stream:${getClientIp(request)}`,
    30,
    60_000,
  );
  if (!connectionLimit.ok) {
    return NextResponse.json(
      { error: 'Too many stream connections', retry_after: connectionLimit.retryAfterSeconds },
      { status: 429, headers: { ...rateLimitHeaders(connectionLimit), 'Cache-Control': 'private, no-store' } },
    );
  }
  if (activeStreams >= MAX_CONCURRENT_STREAMS) {
    return NextResponse.json(
      { error: 'Too many concurrent admin streams', retry_after: 5 },
      { status: 429, headers: { 'Retry-After': '5', 'Cache-Control': 'private, no-store' } },
    );
  }

  const session = (await cookies()).get('palpal_admin_session');
  if (!session || !(await verifyAdminToken(session.value))) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const controller = new AbortController();
  const upstream = await fetch(`${CONDUCTOR_URL}/admin/stream`, {
    headers: {
      Authorization: `Bearer ${ADMIN_KEY}`,
      Accept: 'text/event-stream',
    },
    cache: 'no-store',
    signal: controller.signal,
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new NextResponse('event stream unavailable', {
      status: upstream?.status && upstream.status >= 400 ? upstream.status : 502,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'private, no-store' },
    });
  }

  activeStreams += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeStreams = Math.max(0, activeStreams - 1);
  };

  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controllerStream) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controllerStream.close();
          return;
        }
        controllerStream.enqueue(value);
      } catch {
        release();
        controllerStream.close();
      }
    },
    cancel() {
      release();
      controller.abort();
      void reader.cancel();
    },
  });

  request.signal.addEventListener('abort', () => {
    release();
    controller.abort();
    void reader.cancel();
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...rateLimitHeaders(connectionLimit),
    },
  });
}
