import { NextRequest, NextResponse } from 'next/server';
import { searchClient } from '@/lib/keys';
import { z } from 'zod';

// Schema for updating settings
const updateSettingsSchema = z.object({
  searchableAttributes: z.array(z.string()).optional(),
  filterableAttributes: z.array(z.string()).optional(),
  sortableAttributes: z.array(z.string()).optional(),
  displayedAttributes: z.array(z.string()).optional(),
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

export async function PUT(
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
    const validated = updateSettingsSchema.parse(body);

    const index = searchClient.index(indexName);

    // Update settings
    const updateResponse = await index.updateSettings(validated);

    return NextResponse.json({
      success: true,
      indexName,
      message: 'Index settings updated successfully',
      taskUid: updateResponse.taskUid,
      settings: validated
    });

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

    console.error('Settings update error:', error);

    const errorWithCode = error as { code?: string };
    if (errorWithCode?.code === 'index_not_found') {
      return NextResponse.json(
        { error: 'Index not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update index settings' },
      { status: 500 }
    );
  }
}