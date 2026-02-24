import { NextRequest, NextResponse } from 'next/server';
import { searchClient } from '@/lib/keys';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ indexName: string }> }
) {
  // Validate admin authorization
  const authError = validateAdminAuth(request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: 401 }
    );
  }

  try {
    const { indexName } = await params;
    const index = searchClient.index(indexName);

    // Check if index exists by trying to get its stats
    try {
      const [stats, settings] = await Promise.all([
        index.getStats(),
        index.getSettings()
      ]);

      return NextResponse.json({
        indexName,
        exists: true,
        stats: {
          numberOfDocuments: stats.numberOfDocuments,
          isIndexing: stats.isIndexing,
          fieldDistribution: stats.fieldDistribution
        },
        settings
      });

    } catch (error: unknown) {
      const errorWithStatus = error as { message?: string; status?: number };
      if (errorWithStatus?.message?.includes('not found') || errorWithStatus?.status === 404) {
        return NextResponse.json(
          { error: 'Index not found' },
          { status: 404 }
        );
      }
      throw error;
    }

  } catch (error) {
    console.error('Index retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve index information' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ indexName: string }> }
) {
  // Validate admin authorization
  const authError = validateAdminAuth(request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: 401 }
    );
  }

  try {
    const { indexName } = await params;

    // Delete the index
    const deleteResponse = await searchClient.deleteIndex(indexName);

    return NextResponse.json({
      success: true,
      indexName,
      message: 'Index deleted successfully',
      taskUid: deleteResponse.taskUid
    });

  } catch (error: unknown) {
    console.error('Index deletion error:', error);

    const errorWithCode = error as { code?: string };
    if (errorWithCode?.code === 'index_not_found') {
      return NextResponse.json(
        { error: 'Index not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to delete index' },
      { status: 500 }
    );
  }
}