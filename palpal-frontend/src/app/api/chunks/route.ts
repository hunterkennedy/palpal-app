import { NextRequest, NextResponse } from 'next/server';
import { searchClient } from '@/lib/meilisearch';
import { SearchHit } from '@/types';
import { getAllStaticPodcastConfigs } from '@/lib/static-podcasts';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = searchParams.get('videoId');
  const chunkIndexParam = searchParams.get('chunkIndex');
  const direction = searchParams.get('direction') as 'before' | 'after' | null;
  const limitParam = searchParams.get('limit');
  const loadAll = searchParams.get('loadAll') === 'true';

  if (!videoId) {
    return NextResponse.json(
      { error: 'videoId is required' },
      { status: 400 }
    );
  }

  if (!loadAll && !chunkIndexParam) {
    return NextResponse.json(
      { error: 'chunkIndex is required when not loading all chunks' },
      { status: 400 }
    );
  }

  try {
    const chunkIndex = chunkIndexParam ? parseInt(chunkIndexParam) : 0;
    const limit = limitParam ? parseInt(limitParam) : 5;

    // Get all podcast configs to search across their indexes
    const podcasts = getAllStaticPodcastConfigs();

    if (loadAll) {
      // Search across all podcast indexes to find the video
      let allChunks: SearchHit[] = [];

      for (const podcast of podcasts) {
        if (podcast.enabled && podcast.sources) {
          for (const source of podcast.sources) {
            if (source.enabled) {
              try {
                // Generate index name: {podcast_id}_{source_name_normalized}
                const normalizedSourceName = source.name.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '');
                const indexName = `${podcast.id}_${normalizedSourceName}`;
                const index = searchClient.index(indexName);

                const results = await index.search('', {
                  filter: `video_id = "${videoId}"`,
                  sort: ['chunk_index:asc'],
                  limit: 10000, // High limit to get all chunks
                  attributesToRetrieve: ['*']
                });

                if (results.hits.length > 0) {
                  allChunks = results.hits as SearchHit[];
                  break; // Found the episode, stop searching
                }
              } catch {
                // Index might not exist, continue searching other indexes
                console.warn(`Index ${podcast.id}_${source.name} not found, continuing search...`);
              }
            }
          }
          if (allChunks.length > 0) break; // Found the episode, stop searching podcasts
        }
      }

      return NextResponse.json({
        chunks: allChunks,
        totalChunks: allChunks.length,
        loadedAll: true
      });

    } else if (direction) {
      // Load more chunks in a specific direction
      let filter: string;
      let sort: string[];

      if (direction === 'before') {
        filter = `video_id = "${videoId}" AND chunk_index < ${chunkIndex}`;
        sort = ['chunk_index:desc'];
      } else {
        filter = `video_id = "${videoId}" AND chunk_index > ${chunkIndex}`;
        sort = ['chunk_index:asc'];
      }

      // Search across all podcast indexes to find the video
      let foundChunks: SearchHit[] = [];

      for (const podcast of podcasts) {
        if (podcast.enabled && podcast.sources) {
          for (const source of podcast.sources) {
            if (source.enabled) {
              try {
                // Generate index name: {podcast_id}_{source_name_normalized}
                const normalizedSourceName = source.name.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '');
                const indexName = `${podcast.id}_${normalizedSourceName}`;
                const index = searchClient.index(indexName);

                const results = await index.search('', {
                  filter,
                  sort,
                  limit,
                  attributesToRetrieve: ['*']
                });

                if (results.hits.length > 0) {
                  foundChunks = results.hits as SearchHit[];
                  break; // Found the episode, stop searching
                }
              } catch {
                // Index might not exist, continue searching other indexes
                console.warn(`Index ${podcast.id}_${source.name} not found, continuing search...`);
              }
            }
          }
          if (foundChunks.length > 0) break; // Found the episode, stop searching podcasts
        }
      }

      const chunks = direction === 'before'
        ? foundChunks.reverse() // Reverse for chronological order
        : foundChunks;

      // Check if there are more chunks available
      const hasMore = foundChunks.length === limit;

      return NextResponse.json({
        chunks: chunks,
        hasMoreBefore: direction === 'before' ? hasMore : undefined,
        hasMoreAfter: direction === 'after' ? hasMore : undefined
      });

    } else {
      // Load adjacent chunks (previous and next around the current chunk)
      // First, find which index contains this video
      let targetIndex = null;

      for (const podcast of podcasts) {
        if (podcast.enabled && podcast.sources) {
          for (const source of podcast.sources) {
            if (source.enabled) {
              try {
                // Generate index name: {podcast_id}_{source_name_normalized}
                const normalizedSourceName = source.name.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '');
                const indexName = `${podcast.id}_${normalizedSourceName}`;
                const index = searchClient.index(indexName);

                // Quick check if video exists in this index
                const testResults = await index.search('', {
                  filter: `video_id = "${videoId}"`,
                  limit: 1,
                  attributesToRetrieve: ['id']
                });

                if (testResults.hits.length > 0) {
                  targetIndex = index;
                  break; // Found the right index
                }
              } catch {
                // Index might not exist, continue searching other indexes
                console.warn(`Index ${podcast.id}_${source.name} not found, continuing search...`);
              }
            }
          }
          if (targetIndex) break; // Found the episode, stop searching podcasts
        }
      }

      if (!targetIndex) {
        return NextResponse.json({ chunks: [], hasMoreBefore: false, hasMoreAfter: false });
      }

      const [prevResults, nextResults, totalResults] = await Promise.all([
        // Get previous chunk
        targetIndex.search('', {
          filter: `video_id = "${videoId}" AND chunk_index < ${chunkIndex}`,
          sort: ['chunk_index:desc'],
          limit: 1,
          attributesToRetrieve: ['*']
        }),

        // Get next chunk
        targetIndex.search('', {
          filter: `video_id = "${videoId}" AND chunk_index > ${chunkIndex}`,
          sort: ['chunk_index:asc'],
          limit: 1,
          attributesToRetrieve: ['*']
        }),

        // Get current chunk
        targetIndex.search('', {
          filter: `video_id = "${videoId}" AND chunk_index = ${chunkIndex}`,
          limit: 1,
          attributesToRetrieve: ['*']
        })
      ]);

      const chunks: SearchHit[] = [];
      
      // Add previous chunk if exists
      if (prevResults.hits.length > 0) {
        chunks.push(prevResults.hits[0] as SearchHit);
      }
      
      // Add current chunk
      if (totalResults.hits.length > 0) {
        chunks.push(totalResults.hits[0] as SearchHit);
      }
      
      // Add next chunk if exists
      if (nextResults.hits.length > 0) {
        chunks.push(nextResults.hits[0] as SearchHit);
      }

      // Check if there are more chunks before/after
      const [hasMoreBeforeResults, hasMoreAfterResults] = await Promise.all([
        targetIndex.search('', {
          filter: `video_id = "${videoId}" AND chunk_index < ${chunkIndex - 1}`,
          limit: 1
        }),
        targetIndex.search('', {
          filter: `video_id = "${videoId}" AND chunk_index > ${chunkIndex + 1}`,
          limit: 1
        })
      ]);

      return NextResponse.json({
        chunks,
        hasMoreBefore: hasMoreBeforeResults.hits.length > 0,
        hasMoreAfter: hasMoreAfterResults.hits.length > 0
      });
    }

  } catch (error) {
    console.error('Chunks API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chunks' },
      { status: 500 }
    );
  }
}


export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}