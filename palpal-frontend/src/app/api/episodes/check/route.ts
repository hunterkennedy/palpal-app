import { NextRequest, NextResponse } from 'next/server';
import { searchClient } from '@/lib/keys';
import { z } from 'zod';

const checkEpisodesSchema = z.object({
  indexName: z.string(),
  videoIds: z.array(z.string()).min(1).max(1000), // Allow up to 1000 video IDs
});

export async function POST(request: NextRequest) {
  const adminKey = process.env.MEILISEARCH_ADMIN_KEY;
  const authHeader = request.headers.get('authorization');

  // Check admin authentication
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== adminKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { indexName, videoIds } = checkEpisodesSchema.parse(body);

    const index = searchClient.index(indexName);

    // Handle large batches by processing in chunks if needed
    const chunkSize = 100; // Process 100 video IDs at a time
    const allExistingVideoIds = new Set<string>();

    for (let i = 0; i < videoIds.length; i += chunkSize) {
      const chunk = videoIds.slice(i, i + chunkSize);

      // Search with facets to get all video IDs in this chunk
      const searchResult = await index.search('', {
        filter: `video_id IN [${chunk.map(id => `"${id}"`).join(', ')}]`,
        limit: 1, // We don't need the actual documents, just the facet distribution
        facets: ['video_id']
      });

      const chunkExistingVideoIds = Object.keys(searchResult.facetDistribution?.video_id || {});
      chunkExistingVideoIds.forEach(id => allExistingVideoIds.add(id));
    }

    const existingVideoIds = Array.from(allExistingVideoIds);

    return NextResponse.json({
      existingVideoIds,
      totalChecked: videoIds.length,
      totalFound: existingVideoIds.length
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input parameters',
          details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
        },
        { status: 400 }
      );
    }

    console.error('Episode check API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.ALLOWED_ORIGINS?.split(',') || []].flat()
    : ['http://localhost:3000', 'http://localhost:3001'];

  const isAllowedOrigin = !origin || allowedOrigins.includes(origin);

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': isAllowedOrigin ? (origin || '*') : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}