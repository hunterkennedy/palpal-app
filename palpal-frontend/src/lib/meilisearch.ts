import { TranscriptDocument, MultiSearchResponse, MeiliSearchResult, SearchHitWithIndex } from '@/types';
import { searchClient } from './keys';
import type { SearchParams, MultiSearchParams } from 'meilisearch';


// TranscriptDocument interface moved to @/types

export const TRANSCRIPT_INDEX = 'pal';

// Multi-podcast search function
export async function searchMultiplePodcasts(
  query: string,
  indexNames: string[],
  limit = 10,
  sortBy = 'relevance',
  sortDirection = 'desc',
  dateFilter?: string
) {
  if (indexNames.length === 0) {
    return { hits: [], estimatedTotalHits: 0 };
  }

  if (indexNames.length === 1) {
    // Single index search - use existing function
    return searchTranscripts(query, limit, indexNames[0], sortBy, sortDirection, dateFilter);
  }

  try {
    // Build sort array based on sortBy and direction
    let sort: string[] | undefined;
    if (sortBy !== 'relevance') {
      const field = sortBy === 'date' ? 'publication_date' : sortBy === 'duration' ? 'duration' : 'publication_date';
      sort = [`${field}:${sortDirection}`];
    }

    const searchOptions: SearchParams = {
      limit,
      attributesToHighlight: ['text', 'episode_title', 'podcast_name'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      attributesToRetrieve: ['*'],
      showMatchesPosition: false,
      showRankingScore: true,
      matchingStrategy: 'last',
      ...(sort && { sort }),
      ...(dateFilter && { filter: dateFilter }),
    };

    // Prepare multi-search queries
    const queries: MultiSearchParams['queries'] = indexNames.map(indexName => ({
      indexUid: indexName,
      q: query,
      ...searchOptions
    }));

    const multiSearchParams: MultiSearchParams = { queries };
    const results = await searchClient.multiSearch(multiSearchParams) as MultiSearchResponse;

    return processMultiSearchResults(results, limit, sortBy, sortDirection);
  } catch (error) {
    console.error('Multi-search error:', error);
    throw error;
  }
}

function processMultiSearchResults(results: MultiSearchResponse, limit: number, sortBy = 'relevance', sortDirection = 'desc') {
  // Combine results from all indexes
  let combinedHits: SearchHitWithIndex[] = [];
  let totalHits = 0;

  results.results.forEach((result: MeiliSearchResult) => {
    if (result.hits) {
      // Add index identifier to each hit for tracking
      const hitsWithIndex: SearchHitWithIndex[] = result.hits.map((hit) => ({
        ...hit,
        _podcast_index: result.indexUid
      }));
      combinedHits = combinedHits.concat(hitsWithIndex);
      totalHits += result.estimatedTotalHits || 0;
    }
  });

  // Sort combined results based on user preference
  if (sortBy === 'relevance') {
    // Sort by ranking score based on chosen direction
    if (sortDirection === 'asc') {
      combinedHits.sort((a, b) => (a._rankingScore || 0) - (b._rankingScore || 0));
    } else {
      combinedHits.sort((a, b) => (b._rankingScore || 0) - (a._rankingScore || 0));
    }
  } else {
    // Sort by the specified field and direction
    combinedHits.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (sortBy === 'date') {
        aValue = a.publication_date ? new Date(a.publication_date).getTime() : 0;
        bValue = b.publication_date ? new Date(b.publication_date).getTime() : 0;
      } else if (sortBy === 'duration') {
        aValue = a.duration || 0;
        bValue = b.duration || 0;
      } else {
        // Fallback to publication_date
        aValue = a.publication_date ? new Date(a.publication_date).getTime() : 0;
        bValue = b.publication_date ? new Date(b.publication_date).getTime() : 0;
      }

      if (sortDirection === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });
  }

  // Limit to requested number of results
  combinedHits = combinedHits.slice(0, limit);

  return {
    hits: combinedHits,
    estimatedTotalHits: totalHits
  };
}


export async function searchTranscripts(query: string, limit = 10, indexName = TRANSCRIPT_INDEX, sortBy = 'relevance', sortDirection = 'desc', dateFilter?: string) {
  const index = searchClient.index(indexName);

  try {
    // Build sort array based on sortBy and direction
    let sort: string[] | undefined;
    if (sortBy !== 'relevance') {
      const field = sortBy === 'date' ? 'publication_date' : sortBy === 'duration' ? 'duration' : 'publication_date';
      sort = [`${field}:${sortDirection}`];
    }

    const searchOptions: SearchParams = {
      limit,
      attributesToHighlight: ['text', 'episode_title', 'podcast_name'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      attributesToRetrieve: ['*'],
      showMatchesPosition: false,
      showRankingScore: true,
      matchingStrategy: 'last',
      ...(sort && { sort }),
      ...(dateFilter && { filter: dateFilter }),
    };
    
    const results = await index.search(query, searchOptions);

    return results;
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

export async function getRandomQuoteAnytime(indexName = TRANSCRIPT_INDEX) {
  const index = searchClient.index(indexName);
  
  try {
    // Get total document count
    const stats = await index.getStats();
    const totalDocs = stats.numberOfDocuments;
    
    if (totalDocs === 0) {
      return null;
    }
    
    // Search for documents to get a random sample  
    const results = await index.search('', {
      limit: Math.min(100, totalDocs),
      attributesToRetrieve: ['*']
    });
    
    if (results.hits.length === 0) {
      // Fallback: try with a common word
      const fallbackResults = await index.search('fuck', {
        limit: Math.min(100, totalDocs),
        attributesToRetrieve: ['*']
      });
      
      if (fallbackResults.hits.length === 0) {
        return null;
      }
      
      const randomIndex = Math.floor(Math.random() * fallbackResults.hits.length);
      return fallbackResults.hits[randomIndex] as TranscriptDocument;
    }
    
    const randomIndex = Math.floor(Math.random() * results.hits.length);
    return results.hits[randomIndex] as TranscriptDocument;
    
  } catch (error) {
    console.error('Random quote error:', error);
    return null;
  }
}

export async function getRandomQuote(indexName = TRANSCRIPT_INDEX) {
  const index = searchClient.index(indexName);
  
  try {
    // Use current date as seed to ensure same quote for everyone on the same day
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    
    // Create a robust daily seed
    const dailySeed = (year * 10000 + month * 100 + day) * 31 + (year % 4) * 7 + month * day;
    
    // Get stats first for total document count
    const stats = await index.getStats();
    const totalDocs = stats.numberOfDocuments;
    
    if (totalDocs === 0) {
      return null;
    }
    
    // Use seeded random for consistent daily quote
    const seedRandom = (seed: number) => {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };
    
    // Generate consistent daily offset - ensure we don't exceed bounds
    const maxOffset = Math.max(0, totalDocs - 10);
    const dailyOffset = Math.floor(seedRandom(dailySeed) * maxOffset);
    
    let results = await index.search('', {
      limit: 10,
      offset: dailyOffset,
      attributesToRetrieve: ['*']
    });
    
    // If offset search fails, try without offset
    if (results.hits.length === 0) {
      results = await index.search('', {
        limit: 10,
        attributesToRetrieve: ['*']
      });
    }
    
    // If still no results, try getting any documents
    if (results.hits.length === 0) {
      results = await index.search('*', {
        limit: 10,
        attributesToRetrieve: ['*']
      });
    }
    
    if (results.hits.length === 0) {
      return null;
    }
    
    // Pick consistent daily quote from the available results
    const dailyIndex = Math.floor(seedRandom(dailySeed + 1) * results.hits.length);
    return results.hits[dailyIndex] as TranscriptDocument;
    
  } catch (error) {
    console.error('Daily quote error:', error);
    return null;
  }
}

// Re-export searchClient for API routes that need direct access
export { searchClient } from './keys';