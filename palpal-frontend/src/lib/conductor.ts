/**
 * Server-side fetch wrapper for palpal-conductor API.
 * Uses CONDUCTOR_URL (runtime env, no NEXT_PUBLIC_ prefix).
 */

const CONDUCTOR_URL = process.env.CONDUCTOR_URL || 'http://localhost:8000';

export interface ConductorSearchParams {
  q: string;
  podcast_id?: string;
  sort?: string;
  sort_direction?: 'asc' | 'desc';
  date_from?: string;
  date_to?: string;
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
  if (params.sort) qs.set('sort', params.sort);
  if (params.sort_direction) qs.set('sort_direction', params.sort_direction);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.page != null) qs.set('page', String(params.page));
  if (params.page_size != null) qs.set('page_size', String(params.page_size));

  const res = await fetch(`${CONDUCTOR_URL}/search?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Conductor /search error: ${res.status}`);
  }
  return res.json();
}

export async function getChunks(chunkId: string, radius: number): Promise<ConductorChunk[]> {
  const qs = new URLSearchParams({ chunk_id: chunkId, radius: String(radius) });
  const res = await fetch(`${CONDUCTOR_URL}/chunks?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Conductor /chunks error: ${res.status}`);
  }
  return res.json();
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${CONDUCTOR_URL}/health`);
  if (!res.ok) {
    throw new Error(`Conductor /health error: ${res.status}`);
  }
  return res.json();
}

