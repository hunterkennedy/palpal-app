/**
 * Server-side fetch wrapper for palpal-conductor API.
 * Uses CONDUCTOR_URL (runtime env, no NEXT_PUBLIC_ prefix).
 */

function getConductorUrl(): string {
  const url = process.env.CONDUCTOR_URL;
  if (!url) throw new Error('CONDUCTOR_URL environment variable is not set');
  return url;
}

export interface ConductorSearchParams {
  q: string;
  podcast_id?: string;
  page?: number;
  page_size?: number;
}

export interface ConductorSearchResponse {
  total: number;
  page: number;
  page_size: number;
  results: ConductorChunk[];
}

export interface ConductorChunk {
  id: string;
  episode_id: string;
  chunk_index: number;
  text: string;
  start_time: number;
  end_time: number;
  duration: number;
  start_formatted: string;
  start_minutes: number;
  word_count: number;
  podcast_id: string;
  podcast_name: string;
  source_name: string;
  episode_title: string;
  video_id: string;
  publication_date: string | null;
  rank?: number;
  text_highlighted?: string;
  title_highlighted?: string;
}

export async function searchChunks(params: ConductorSearchParams): Promise<ConductorSearchResponse> {
  const qs = new URLSearchParams();
  qs.set('q', params.q);
  if (params.podcast_id) qs.set('podcast_id', params.podcast_id);
  if (params.page != null) qs.set('page', String(params.page));
  if (params.page_size != null) qs.set('page_size', String(params.page_size));

  const res = await fetch(`${getConductorUrl()}/search?${qs.toString()}`, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`Conductor /search error: ${res.status}`);
  }
  return res.json();
}

export async function getChunks(chunkId: string, radius: number): Promise<ConductorChunk[]> {
  const qs = new URLSearchParams({ chunk_id: chunkId, radius: String(radius) });
  const res = await fetch(`${getConductorUrl()}/chunks?${qs.toString()}`, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`Conductor /chunks error: ${res.status}`);
  }
  return res.json();
}

export interface EpisodeInfo {
  id: string;
  video_id: string;
  title: string;
  publication_date: string | null;
  status: string;
  blacklisted: boolean;
  podcast_id: string;
  podcast_name: string;
  source_name: string;
  site: string;
  chunk_count: number;
  duration_seconds: number | null;
  youtube_url: string;
}

export async function getEpisodes(): Promise<EpisodeInfo[]> {
  const res = await fetch(`${getConductorUrl()}/episodes`, { next: { revalidate: 21600 } });
  if (!res.ok) throw new Error(`Conductor /episodes error: ${res.status}`);
  return res.json();
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${getConductorUrl()}/health`);
  if (!res.ok) {
    throw new Error(`Conductor /health error: ${res.status}`);
  }
  return res.json();
}

export interface ConductorPodcast {
  id: string;
  display_name: string;
  image: string | null;
  has_icon: boolean;
  social_sections: Array<{
    title: string;
    titleColor: string;
    links: Array<{ site: string; title: string; link: string; icon: string; hoverColor: string }>;
  }> | null;
  display_order: number;
}

export async function getPodcasts(): Promise<ConductorPodcast[]> {
  const res = await fetch(`${getConductorUrl()}/podcasts`, { next: { revalidate: 21600 } });
  if (!res.ok) throw new Error(`Conductor /podcasts error: ${res.status}`);
  return res.json();
}

export interface WhatsNewEntry {
  id: number;
  content: string;
  posted_at: string;
}

export async function getWhatsNew(): Promise<WhatsNewEntry[]> {
  try {
    const res = await fetch(`${getConductorUrl()}/whats-new`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

