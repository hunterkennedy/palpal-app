/**
 * Utility functions for processing transcript chunks
 */

import { SearchHit } from '@/types';

export interface ChunkLike {
  video_id: string;
  start_time?: number;
  podcast_name?: string;
  source_name?: string;
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
  // Check if source_name contains "patreon" (case-insensitive)
  return hit.source_name?.toLowerCase().includes('patreon') ?? false;
}

/**
 * Generates a Patreon URL for an episode
 */
export function getPatreonUrl(episodeId: string): string {
  return `https://www.patreon.com/posts/${episodeId}`;
}

/**
 * Gets the appropriate watch URL for a search hit
 */
export function getWatchUrl(hit: SearchHit | ChunkLike): string {
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
  return 'Watch on YouTube';
}