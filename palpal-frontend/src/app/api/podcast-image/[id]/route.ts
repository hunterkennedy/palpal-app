import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const conductorUrl = process.env.CONDUCTOR_URL;

  try {
    const response = await fetch(`${conductorUrl}/podcasts/${id}/image`, {
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return new NextResponse(null, { status: 404 });
    }

    const imageData = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(imageData, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
