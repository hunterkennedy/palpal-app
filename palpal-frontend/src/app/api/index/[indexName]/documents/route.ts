import { NextRequest, NextResponse } from 'next/server';
import { searchClient } from '@/lib/keys';
import { z } from 'zod';

// Schema for document upload
const uploadDocumentsSchema = z.object({
  documents: z.array(z.object({
    id: z.string(),
    text: z.string(),
    podcast_id: z.string(),
    podcast_name: z.string(),
    source_name: z.string(),
    episode_id: z.string(),
    episode_title: z.string(),
    video_id: z.string(),
    publication_date: z.string().optional().nullable(),
    start_time: z.number(),
    end_time: z.number(),
    duration: z.number(),
    chunk_index: z.number(),
    start_formatted: z.string(),
    start_minutes: z.number(),
    word_count: z.number()
  })).min(1).max(1000) // Limit batch size
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

export async function POST(
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
    const body = await request.json();
    const validated = uploadDocumentsSchema.parse(body);

    const { documents } = validated;

    const index = searchClient.index(indexName);

    // Add documents to the index
    const addResponse = await index.addDocuments(documents);

    return NextResponse.json({
      success: true,
      indexName,
      documentsAdded: documents.length,
      message: `Successfully queued ${documents.length} documents for indexing`,
      taskUid: addResponse.taskUid
    }, { status: 202 }); // 202 Accepted since indexing is async

  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input parameters',
          details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
        },
        { status: 400 }
      );
    }

    console.error('Document upload error:', error);

    const errorWithCode = error as { code?: string };
    if (errorWithCode?.code === 'index_not_found') {
      return NextResponse.json(
        { error: 'Index not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to upload documents' },
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
    const { searchParams } = new URL(request.url);

    // Support deleting by document ID or all documents
    const documentId = searchParams.get('id');

    const index = searchClient.index(indexName);

    if (documentId) {
      // Delete specific document
      const deleteResponse = await index.deleteDocument(documentId);

      return NextResponse.json({
        success: true,
        indexName,
        message: `Document ${documentId} queued for deletion`,
        taskUid: deleteResponse.taskUid
      });
    } else {
      // Delete all documents
      const deleteResponse = await index.deleteAllDocuments();

      return NextResponse.json({
        success: true,
        indexName,
        message: 'All documents queued for deletion',
        taskUid: deleteResponse.taskUid
      });
    }

  } catch (error: unknown) {
    console.error('Document deletion error:', error);

    const errorWithCode = error as { code?: string };
    if (errorWithCode?.code === 'index_not_found') {
      return NextResponse.json(
        { error: 'Index not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to delete documents' },
      { status: 500 }
    );
  }
}