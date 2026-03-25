'use client';

import React, { useState, useCallback } from 'react';
import {
  Clock,
  Play,
  Bookmark,
  BookmarkCheck,
  Calendar,
  ChevronDown,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import Image from 'next/image';
// Strip all tags except <mark> (data is from our own ts_headline, no external input)
function sanitizeHighlight(html: string): string {
  return html.replace(/<(?!\/?mark\s*>)[^>]*>/gi, '');
}
import { SearchHit } from '@/types';
import { PodcastConfig } from '@/types/podcast';
import { getWatchUrl, getWatchText, isPatreonSource } from '@/lib/chunk-utils';
import ChunkNotes from '@/components/ChunkNotes';
import ChunkContextView from '@/components/ChunkContextView';
import { ConductorChunk } from '@/lib/conductor';

const formatPublicationDate = (dateString?: string): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.ceil(Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

interface ContextData {
  chunks: ConductorChunk[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

interface SearchResultCardProps {
  hit: SearchHit;
  groupKey: string;
  index: number;
  isSaved: boolean;
  isWatched?: boolean;
  onSaveToggle: (hit: SearchHit, event: React.MouseEvent) => void;
  podcasts?: PodcastConfig[];
}

export default function SearchResultCard({
  hit,
  groupKey,
  index,
  isSaved,
  isWatched = false,
  onSaveToggle,
  podcasts,
}: SearchResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [radius, setRadius] = useState(2);

  const fetchContext = useCallback(
    async (r: number) => {
      if (!hit.id) return;
      setIsLoadingContext(true);
      try {
        const res = await fetch(`/api/chunks?chunkId=${encodeURIComponent(hit.id)}&radius=${r}`);
        if (!res.ok) throw new Error('Failed');
        const data: ContextData = await res.json();
        // If loading more didn't extend the window, suppress the button in that direction
        setContextData(prev => {
          if (prev && r > 2) {
            const prevFirstId = prev.chunks[0]?.id;
            const prevLastId = prev.chunks[prev.chunks.length - 1]?.id;
            const newFirstId = data.chunks[0]?.id;
            const newLastId = data.chunks[data.chunks.length - 1]?.id;
            return {
              ...data,
              hasMoreBefore: data.hasMoreBefore && newFirstId !== prevFirstId,
              hasMoreAfter: data.hasMoreAfter && newLastId !== prevLastId,
            };
          }
          return data;
        });
      } catch {
        // context fetch failed silently; button stays available to retry
      } finally {
        setIsLoadingContext(false);
      }
    },
    [hit.id],
  );

  const handleToggleContext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hit.id) return;
    if (isExpanded) {
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
      if (!contextData) {
        fetchContext(radius);
      }
    }
  };

  const handleLoadMore = useCallback(() => {
    const newRadius = radius + 2;
    setRadius(newRadius);
    fetchContext(newRadius);
  }, [radius, fetchContext]);

  const podcastConfig = podcasts?.find(p => p.id === hit.podcast_id) ?? null;

  return (
    <article
      role="listitem"
      className="card-primary hover:border-orange-500/50 focus-within:ring-2 focus-within:ring-orange-500 focus-within:ring-offset-2 focus-within:ring-offset-gray-900 transition-all duration-200 group relative"
      aria-labelledby={`result-${groupKey}-${index}-title`}
      aria-describedby={`result-${groupKey}-${index}-content result-${groupKey}-${index}-meta`}
    >
      <div className="mb-4">
        {hit.title_highlighted ? (
          <h3
            id={`result-${groupKey}-${index}-title`}
            className="heading-secondary [&_mark]:bg-orange-500 [&_mark]:text-white [&_mark]:px-1 [&_mark]:rounded"
            dangerouslySetInnerHTML={{
              __html: sanitizeHighlight(hit.title_highlighted),
            }}
          />
        ) : (
          <h3
            id={`result-${groupKey}-${index}-title`}
            className="heading-secondary"
          >
            {hit.episode_title}
          </h3>
        )}

        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 flex-1">
            {podcastConfig?.image ? (
              <Image
                src={podcastConfig.image}
                alt={`${hit.podcast_name} icon`}
                width={20}
                height={20}
                unoptimized
                className="rounded-full flex-shrink-0"
              />
            ) : null}
            <span className="text-meta font-medium">{hit.podcast_name}</span>
          </div>

          {hit.publication_date && (
            <div className="flex items-center gap-1 text-meta text-sm">
              <Calendar className="w-3 h-3" />
              <span>{formatPublicationDate(hit.publication_date)}</span>
            </div>
          )}

          {isWatched && (
            <div className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--success)' }}>
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
              <span>Watched</span>
            </div>
          )}
        </div>

        <div className="prose max-w-none">
          {hit.text_highlighted ? (
            <p
              id={`result-${groupKey}-${index}-content`}
              className="text-body leading-relaxed [&_mark]:bg-orange-500 [&_mark]:text-white [&_mark]:px-1 [&_mark]:rounded"
              dangerouslySetInnerHTML={{
                __html: sanitizeHighlight(hit.text_highlighted),
              }}
            />
          ) : (
            <p
              id={`result-${groupKey}-${index}-content`}
              className="text-body leading-relaxed"
            >
              {hit.text}
            </p>
          )}
        </div>

        {hit.id && isSaved && <ChunkNotes chunkId={hit.id} />}
      </div>

      <div className="flex items-center justify-between">
        <div
          id={`result-${groupKey}-${index}-meta`}
          className="flex flex-wrap gap-4 text-sm text-gray-400"
        >
          <a
            href={getWatchUrl(hit)}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 rounded-md p-1 -m-1 ${
              isPatreonSource(hit)
                ? 'text-orange-500 hover:text-orange-400 focus:ring-orange-500'
                : 'text-red-500 hover:text-red-400 focus:ring-red-500'
            }`}
            aria-label={`${getWatchText(hit).replace('Watch on ', `Watch "${hit.episode_title}" on `)}${isPatreonSource(hit) ? '' : ` starting at ${hit.start_formatted}`}`}
            onClick={e => e.stopPropagation()}
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            <span>{getWatchText(hit)}</span>
          </a>

          <div className="flex items-center gap-1" aria-label={`Timestamp: ${hit.start_formatted}`}>
            <Clock className="w-4 h-4" aria-hidden="true" />
            <span>{hit.start_formatted}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Context expand toggle */}
          {hit.id && (
            <button
              onClick={handleToggleContext}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-gray-500 pill-enhanced border"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}
              aria-label={isExpanded ? 'Hide episode context' : 'Show episode context'}
              aria-expanded={isExpanded}
            >
              {isLoadingContext && !isExpanded ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              )}
              <span>Context</span>
            </button>
          )}

          {/* Save button */}
          {hit.id && (
            <button
              onClick={e => onSaveToggle(hit, e)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 group/save ${
                isSaved
                  ? 'pill-selected focus:ring-orange-500'
                  : 'pill-enhanced focus:ring-gray-500'
              }`}
              aria-label={isSaved ? 'Remove from saved' : 'Save this chunk'}
            >
              {isSaved ? (
                <BookmarkCheck
                  className="w-4 h-4 group-hover/save:scale-110 transition-transform duration-200"
                  aria-hidden="true"
                />
              ) : (
                <Bookmark
                  className="w-4 h-4 group-hover/save:scale-110 transition-transform duration-200"
                  aria-hidden="true"
                />
              )}
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline context expansion */}
      {isExpanded && contextData && (
        <ChunkContextView
          chunks={contextData.chunks}
          matchedChunkId={hit.id}
          hasMoreBefore={contextData.hasMoreBefore}
          hasMoreAfter={contextData.hasMoreAfter}
          isLoading={isLoadingContext}
          onLoadMore={handleLoadMore}
        />
      )}
      {isExpanded && !contextData && isLoadingContext && (
        <div
          className="mt-4 border-t pt-4 flex items-center justify-center py-6"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
    </article>
  );
}
