/**
 * Cookie utility functions for storing user preferences
 */

interface UserPreferences {
  selectedPodcasts: string[];
}

interface SavedChunk {
  id: string;
  text: string;
  episode_title: string;
  video_id: string;
  start_formatted: string;
  end_formatted?: string;
  podcast_name: string;
  source_name?: string;
  savedAt: number; // timestamp
  notes?: string; // User notes
}

const PREFERENCES_KEY = 'palpal_preferences'; // localStorage key
const PREFERENCES_COOKIE = 'palpal_preferences'; // legacy cookie (migrated on read)
const SAVED_CHUNKS_KEY = 'palpal_saved_chunks'; // localStorage key
const SAVED_CHUNKS_COOKIE = 'palpal_saved_chunks'; // legacy cookie name (for migration)
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

function isValidPreferences(value: unknown): value is UserPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const preferences = value as UserPreferences;
  return (
    Array.isArray(preferences.selectedPodcasts) &&
    preferences.selectedPodcasts.every(podcast => typeof podcast === 'string')
  );
}

function parsePreferences(raw: string | null): UserPreferences | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isValidPreferences(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Save user preferences to localStorage. These are functional settings, not
 * tracking data, so they stay on the device and are never sent to the server.
 */
export function saveUserPreferences(preferences: UserPreferences): void {
  try {
    lsSet(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Failed to save user preferences:', error);
  }
}

/**
 * Load user preferences from localStorage, migrating the legacy
 * `palpal_preferences` cookie on first read.
 */
export function loadUserPreferences(): UserPreferences | null {
  try {
    const storedRaw = lsGet(PREFERENCES_KEY);
    if (storedRaw) {
      const stored = parsePreferences(storedRaw);
      if (stored) return stored;
      lsRemove(PREFERENCES_KEY);
    }

    // One-time migration: move the old cookie value into localStorage, then
    // expire the cookie so regular visitors stop sending it with requests.
    const legacyRaw = getCookie(PREFERENCES_COOKIE);
    if (!legacyRaw) return null;

    const preferences = parsePreferences(legacyRaw);
    if (!preferences) {
      setCookie(PREFERENCES_COOKIE, '', -1);
      return null;
    }

    if (lsSet(PREFERENCES_KEY, JSON.stringify(preferences))) {
      setCookie(PREFERENCES_COOKIE, '', -1);
    }
    return preferences;
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
    selectedPodcasts: ['pal'] // Default to PAL selected
  };
}

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('localStorage write failed:', e);
    return false;
  }
}

function lsRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
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
  end_formatted?: string;
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

    lsSet(SAVED_CHUNKS_KEY, JSON.stringify(trimmed));
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
    lsSet(SAVED_CHUNKS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.warn('Failed to unsave chunk:', error);
  }
}

/**
 * Get all saved chunks. Migrates legacy cookie data to localStorage on first read.
 */
export function getSavedChunks(): SavedChunk[] {
  try {
    let raw = lsGet(SAVED_CHUNKS_KEY);

    // One-time migration: move data from old cookie storage to localStorage
    if (!raw) {
      const legacy = getCookie(SAVED_CHUNKS_COOKIE);
      if (legacy) {
        lsSet(SAVED_CHUNKS_KEY, legacy);
        setCookie(SAVED_CHUNKS_COOKIE, '', -1); // expire the old cookie
        raw = legacy;
      }
    }

    if (!raw) return [];

    const chunks = JSON.parse(raw) as SavedChunk[];

    if (Array.isArray(chunks)) {
      return chunks.filter(chunk =>
        chunk &&
        typeof chunk.id === 'string' &&
        typeof chunk.text === 'string' &&
        typeof chunk.episode_title === 'string' &&
        typeof chunk.video_id === 'string' &&
        typeof chunk.start_formatted === 'string' &&
        (chunk.end_formatted === undefined || typeof chunk.end_formatted === 'string') &&
        typeof chunk.podcast_name === 'string' &&
        typeof chunk.savedAt === 'number' &&
        (chunk.source_name === undefined || typeof chunk.source_name === 'string')
      );
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
  return getSavedChunks().some(chunk => chunk.id === chunkId);
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
    lsSet(SAVED_CHUNKS_KEY, JSON.stringify(updatedChunks));
  } catch (error) {
    console.warn('Failed to update chunk notes:', error);
  }
}

/**
 * Get notes for a specific chunk
 */
export function getChunkNotes(chunkId: string): string {
  const chunk = getSavedChunks().find(c => c.id === chunkId);
  return chunk?.notes || '';
}

/**
 * Clear all saved chunks
 */
export function clearSavedChunks(): void {
  try {
    lsRemove(SAVED_CHUNKS_KEY);
  } catch (error) {
    console.warn('Failed to clear saved chunks:', error);
  }
}


export type { SavedChunk };