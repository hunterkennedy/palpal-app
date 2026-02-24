import { NextRequest, NextResponse } from 'next/server';
import { searchClient } from '@/lib/keys';
import { z } from 'zod';

// Schema for creating an index
const createIndexSchema = z.object({
  indexName: z.string().min(1).max(64),
  settings: z.object({
    searchableAttributes: z.array(z.string()).optional(),
    filterableAttributes: z.array(z.string()).optional(),
    sortableAttributes: z.array(z.string()).optional(),
    displayedAttributes: z.array(z.string()).optional(),
  }).optional()
});

// Validate admin authorization
function validateAdminAuth(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return 'Missing or invalid authorization header';
  }

  const token = authHeader.slice(7);
  const adminKey = process.env.MEILISEARCH_ADMIN_KEY;

  if (!adminKey || token !== adminKey) {
    return 'Invalid admin key';
  }

  return null;
}

export async function POST(request: NextRequest) {
  // Validate admin authorization
  const authError = validateAdminAuth(request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const validated = createIndexSchema.parse(body);

    const { indexName, settings } = validated;

    // Create the index with primary key
    const createResponse = await searchClient.createIndex(indexName, { primaryKey: 'id' });

    // Apply settings if provided
    if (settings) {
      const index = searchClient.index(indexName);
      await index.updateSettings(settings);
    }

    return NextResponse.json({
      success: true,
      indexName,
      message: 'Index created successfully',
      taskUid: createResponse.taskUid
    }, { status: 201 });

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

    console.error('Index creation error:', error);

    // Handle Meilisearch-specific errors
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'index_already_exists') {
        return NextResponse.json(
          { error: 'Index already exists' },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to create index' },
      { status: 500 }
    );
  }
}