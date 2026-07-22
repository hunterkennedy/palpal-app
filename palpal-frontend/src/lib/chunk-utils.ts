/**
 * Utility functions for processing transcript chunks
 */

import { SearchHit } from '@/types';

export interface ChunkLike {
  video_id: string;
  start_time?: number;
  podcast_name?: string;
  source_name?: string;
  site?: string;
}

export interface ProcessedChunk extends SearchHit {
  isOriginal?: boolean;
  trimmedText?: string;
  originalText?: string;
}

/**
 * Formats a timestamp for YouTube URLs
 */
export function formatYouTubeTimestamp(seconds: number): string {
  return Math.floor(seconds).toString();
}

/**
 * Generates a YouTube URL with timestamp
 */
export function getYouTubeUrl(videoId: string, startTime: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${formatYouTubeTimestamp(startTime)}s`;
}

/**
 * Checks if a search hit is from a Patreon source
 */
export function isPatreonSource(hit: SearchHit | ChunkLike): boolean {
  return hit.site === 'patreon';
}

/**
 * Checks if a search hit is from a generic RSS source. These have no public
 * watch page — the feed URL carries a private auth token, so it's never sent
 * to the browser — see getWatchUrl.
 */
export function isRssSource(hit: SearchHit | ChunkLike): boolean {
  return hit.site === 'rss';
}

/**
 * Generates a Patreon URL for an episode
 */
export function getPatreonUrl(episodeId: string): string {
  return `https://www.patreon.com/posts/${episodeId}`;
}

/**
 * Gets the appropriate watch URL for a search hit, or null if there isn't
 * one to offer (RSS sources).
 */
export function getWatchUrl(hit: SearchHit | ChunkLike): string | null {
  if (isRssSource(hit)) {
    return null;
  }
  if (isPatreonSource(hit)) {
    return getPatreonUrl(hit.video_id);
  }
  return getYouTubeUrl(hit.video_id, hit.start_time || 0);
}

/**
 * Gets the appropriate watch text for a search hit
 */
export function getWatchText(hit: SearchHit | ChunkLike): string {
  if (isPatreonSource(hit)) {
    return 'Watch on Patreon';
  }
  if (isRssSource(hit)) {
    return '';
  }
  return 'Watch on YouTube';
}