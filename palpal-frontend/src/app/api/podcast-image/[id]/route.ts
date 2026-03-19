import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const conductorUrl = process.env.CONDUCTOR_URL;

  try {
    const response = await fetch(`${conductorUrl}/podcasts/${id}/image`);

    if (!response.ok) {
      return new NextResponse(null, { status: 404 });
    }

    const imageData = await response.arrayBuffer();
    const compressed = await sharp(Buffer.from(imageData))
      .resize(128, 128, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer();

    return new NextResponse(compressed, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
