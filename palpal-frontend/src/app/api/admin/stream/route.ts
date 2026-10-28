import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONDUCTOR_URL = process.env.CONDUCTOR_URL!;
const ADMIN_KEY = process.env.CONDUCTOR_ADMIN_KEY!;

export async function GET(request: NextRequest) {
  const session = (await cookies()).get('palpal_admin_session');
  if (!session || !(await verifyAdminToken(session.value))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controllerStream) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controllerStream.close();
          return;
        }
        controllerStream.enqueue(value);
      } catch {
        controllerStream.close();
      }
    },
    cancel() {
      controller.abort();
      void reader.cancel();
    },
  });

  request.signal.addEventListener('abort', () => {
    controller.abort();
    void reader.cancel();
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
