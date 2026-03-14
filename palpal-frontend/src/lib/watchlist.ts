const WATCHED_KEY = 'palpal_watched_episodes';

function getWatchedSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(WATCHED_KEY);
    if (!stored) return new Set();
    const arr = JSON.parse(stored) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveWatchedSet(watched: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...watched]));
  } catch (err) {
    console.warn('Failed to save watched episodes:', err);
  }
}

export function toggleWatched(videoId: string): boolean {
  const watched = getWatchedSet();
  if (watched.has(videoId)) {
    watched.delete(videoId);
    saveWatchedSet(watched);
    return false;
  } else {
    watched.add(videoId);
    saveWatchedSet(watched);
    return true;
  }
}

export function getWatchedVideoIds(): Set<string> {
  return getWatchedSet();
}

export function clearWatched(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(WATCHED_KEY);
  } catch {
    // ignore
  }
}

export interface WatchlistExport {
  version: 1;
  exported_at: string;
  watched: Array<{ video_id: string; title?: string; date?: string | null }>;
}

export function exportWatched(
  episodes: Array<{ video_id: string; title: string; publication_date: string | null }>,
): void {
  const watched = getWatchedSet();
  const payload: WatchlistExport = {
    version: 1,
    exported_at: new Date().toISOString(),
    watched: [...watched].map(video_id => {
      const ep = episodes.find(e => e.video_id === video_id);
      return { video_id, title: ep?.title, date: ep?.publication_date ?? null };
    }),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `palpal-watched-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importWatched(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw = JSON.parse(e.target?.result as string);
        let videoIds: string[] = [];
        if (raw?.version === 1 && Array.isArray(raw.watched)) {
          // Rich format
          videoIds = raw.watched
            .map((entry: unknown) => (entry as { video_id?: string }).video_id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
        } else if (Array.isArray(raw)) {
          // Plain array of strings fallback
          videoIds = raw.filter((id): id is string => typeof id === 'string');
        } else {
          throw new Error('Unrecognised format');
        }
        const watched = getWatchedSet();
        const before = watched.size;
        videoIds.forEach(id => watched.add(id));
        saveWatchedSet(watched);
        resolve(watched.size - before);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
