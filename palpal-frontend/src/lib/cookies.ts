/**
 * Cookie utility functions for storing user preferences
 */

export type SearchMode = 'hybrid' | 'semantic' | 'keyword';

interface UserPreferences {
  searchMode: SearchMode;
  selectedPodcasts: string[];
}

interface SavedChunk {
  id: string;
  text: string;
  episode_title: string;
  video_id: string;
  start_formatted: string;
  end_formatted: string;
  podcast_name: string;
  source_name?: string;
  savedAt: number; // timestamp
  notes?: string; // User notes
}

const PREFERENCES_COOKIE = 'palpal_preferences';
const SAVED_CHUNKS_COOKIE = 'palpal_saved_chunks';
const WHATS_NEW_COOKIE = 'palpal_whats_new_dismissed';
const COOKIE_EXPIRY_DAYS = 365; // 1 year

/**
 * Set a cookie with expiration
 */
function setCookie(name: string, value: string, days: number = COOKIE_EXPIRY_DAYS): void {
  if (typeof window === 'undefined') return; // SSR safety
  
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value};${expires};path=/;SameSite=Lax`;
}

/**
 * Get a cookie value
 */
function getCookie(name: string): string | null {
  if (typeof window === 'undefined') return null; // SSR safety
  
  const nameEQ = `${name}=`;
  const ca = document.cookie.split(';');
  
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

/**
 * Save user preferences to cookie
 */
export function saveUserPreferences(preferences: UserPreferences): void {
  try {
    const prefString = JSON.stringify(preferences);
    setCookie(PREFERENCES_COOKIE, prefString);
  } catch (error) {
    console.warn('Failed to save user preferences:', error);
  }
}

/**
 * Load user preferences from cookie
 */
export function loadUserPreferences(): UserPreferences | null {
  try {
    const prefString = getCookie(PREFERENCES_COOKIE);
    if (!prefString) return null;
    
    const preferences = JSON.parse(prefString) as UserPreferences;
    
    // Validate the loaded preferences
    if (
      typeof preferences === 'object' &&
      preferences !== null &&
      ['hybrid', 'semantic', 'keyword'].includes(preferences.searchMode) &&
      Array.isArray(preferences.selectedPodcasts)
    ) {
      return preferences;
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to load user preferences:', error);
    return null;
  }
}

/**
 * Get default user preferences
 */
export function getDefaultPreferences(): UserPreferences {
  return {
    searchMode: 'hybrid',
    selectedPodcasts: ['pal'] // Default to PAL selected
  };
}

/**
 * Save a chunk to the saved chunks list
 */
export function saveChunk(chunk: {
  id: string;
  text: string;
  episode_title: string;
  video_id: string;
  start_formatted: string;
  end_formatted: string;
  podcast_name: string;
  source_name?: string;
  notes?: string;
}): void {
  try {
    const savedChunks = getSavedChunks();

    const newChunk: SavedChunk = {
      ...chunk,
      savedAt: Date.now()
    };

    // Remove if already exists (avoid duplicates)
    const filtered = savedChunks.filter(saved => saved.id !== chunk.id);
    filtered.unshift(newChunk); // Add to beginning

    // Keep only the most recent 100 chunks
    const trimmed = filtered.slice(0, 100);

    const chunksString = JSON.stringify(trimmed);
    setCookie(SAVED_CHUNKS_COOKIE, chunksString);
  } catch (error) {
    console.warn('Failed to save chunk:', error);
  }
}

/**
 * Remove a chunk from the saved chunks list
 */
export function unsaveChunk(chunkId: string): void {
  try {
    const savedChunks = getSavedChunks();
    const filtered = savedChunks.filter(saved => saved.id !== chunkId);
    
    const chunksString = JSON.stringify(filtered);
    setCookie(SAVED_CHUNKS_COOKIE, chunksString);
  } catch (error) {
    console.warn('Failed to unsave chunk:', error);
  }
}

/**
 * Get all saved chunks
 */
export function getSavedChunks(): SavedChunk[] {
  try {
    const chunksString = getCookie(SAVED_CHUNKS_COOKIE);

    if (!chunksString) {
      return [];
    }

    const chunks = JSON.parse(chunksString) as SavedChunk[];

    // Validate the loaded chunks
    if (Array.isArray(chunks)) {
      const validChunks = chunks.filter(chunk =>
        chunk &&
        typeof chunk.id === 'string' &&
        typeof chunk.text === 'string' &&
        typeof chunk.episode_title === 'string' &&
        typeof chunk.video_id === 'string' &&
        typeof chunk.start_formatted === 'string' &&
        typeof chunk.end_formatted === 'string' &&
        typeof chunk.podcast_name === 'string' &&
        typeof chunk.savedAt === 'number' &&
        (chunk.source_name === undefined || typeof chunk.source_name === 'string')
      );
      return validChunks;
    }
    return [];
  } catch (error) {
    console.warn('Failed to load saved chunks:', error);
    return [];
  }
}

/**
 * Check if a chunk is saved
 */
export function isChunkSaved(chunkId: string): boolean {
  const savedChunks = getSavedChunks();
  const isSaved = savedChunks.some(chunk => chunk.id === chunkId);
  return isSaved;
}

/**
 * Update notes for a saved chunk
 */
export function updateChunkNotes(chunkId: string, notes: string): void {
  try {
    const savedChunks = getSavedChunks();
    const updatedChunks = savedChunks.map(chunk =>
      chunk.id === chunkId ? { ...chunk, notes } : chunk
    );

    const chunksString = JSON.stringify(updatedChunks);
    setCookie(SAVED_CHUNKS_COOKIE, chunksString);
  } catch (error) {
    console.warn('Failed to update chunk notes:', error);
  }
}

/**
 * Get notes for a specific chunk
 */
export function getChunkNotes(chunkId: string): string {
  const savedChunks = getSavedChunks();
  const chunk = savedChunks.find(c => c.id === chunkId);
  return chunk?.notes || '';
}

/**
 * Clear all saved chunks
 */
export function clearSavedChunks(): void {
  try {
    setCookie(SAVED_CHUNKS_COOKIE, '[]');
  } catch (error) {
    console.warn('Failed to clear saved chunks:', error);
  }
}

/**
 * Mark the what's new bubble as dismissed for a specific version
 */
export function dismissWhatsNew(version: string): void {
  try {
    setCookie(WHATS_NEW_COOKIE, version);
  } catch (error) {
    console.warn('Failed to dismiss what\'s new:', error);
  }
}

/**
 * Check if the what's new bubble has been dismissed for a specific version
 */
export function isWhatsNewDismissed(version: string): boolean {
  try {
    const dismissedVersion = getCookie(WHATS_NEW_COOKIE);
    return dismissedVersion === version;
  } catch (error) {
    console.warn('Failed to check what\'s new status:', error);
    return false;
  }
}

export type { SavedChunk };