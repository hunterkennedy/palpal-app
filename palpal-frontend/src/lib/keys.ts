import { MeiliSearch } from 'meilisearch';

// Server-side admin client for key management
const getAdminClient = () => {
  if (typeof window !== 'undefined') {
    throw new Error('Admin client should only be used on the server side');
  }
  
  return new MeiliSearch({
    host: process.env.NEXT_PUBLIC_MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILI_MASTER_KEY,
  });
};

// Client-side search client with read-only key
const getSearchClient = () => {
  return new MeiliSearch({
    host: process.env.NEXT_PUBLIC_MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.NEXT_PUBLIC_MEILISEARCH_SEARCH_KEY || process.env.MEILI_MASTER_KEY, // Fallback for dev
  });
};

// Function to create API keys (run this once in production setup)
export async function createApiKeys() {
  if (typeof window !== 'undefined') {
    throw new Error('Key creation should only be done on the server side');
  }

  try {
    const adminClient = getAdminClient();
    
    // Create an admin key with full permissions
    const adminKey = await adminClient.createKey({
      description: 'palpal Admin key',
      actions: ['*'],
      indexes: ['*'],
      expiresAt: null, // Never expires, but should be rotated regularly
    });

    // Create a search-only key with restricted permissions
    const searchKey = await adminClient.createKey({
      description: 'palpal Search-only key',
      actions: ['search'],
      indexes: ['transcripts'],
      expiresAt: null, // Never expires, but should be rotated regularly
    });

    
    return { adminKey, searchKey };
  } catch (error) {
    console.error('Failed to create API keys:', error);
    throw error;
  }
}

// Legacy function for backwards compatibility
export async function createSearchOnlyKey() {
  const { searchKey } = await createApiKeys();
  return searchKey;
}

// Export the appropriate client based on environment
export const searchClient = typeof window !== 'undefined' 
  ? getSearchClient()  // Client-side: use search-only key
  : getAdminClient();  // Server-side: use admin key

// Export admin client for server-side operations that need it
export const adminClient = getAdminClient;

