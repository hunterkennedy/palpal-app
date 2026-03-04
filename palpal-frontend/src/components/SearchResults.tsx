'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Play, AlertTriangle, RefreshCw, Bookmark, BookmarkCheck, Calendar } from 'lucide-react';
import Image from 'next/image';
import DOMPurify from 'dompurify';
import { SearchHit, ErrorState } from '@/types';
import { saveChunk, unsaveChunk, isChunkSaved } from '@/lib/cookies';
import { SearchResultsSkeleton } from '@/components/LoadingSkeleton';
import { getStaticPodcastConfig } from '@/lib/static-podcasts';
import { GroupByOption } from '@/components/GroupByFilter';
import ChunkNotes from '@/components/ChunkNotes';
import { getWatchUrl, getWatchText, isPatreonSource } from '@/lib/chunk-utils';

interface SearchResultsProps {
  query: string;
  results: SearchHit[];
  totalHits: number;
  error: ErrorState | null;
  isSearching: boolean;
  refreshSaveStatus?: boolean;
  groupBy?: GroupByOption;
}

// Helper function to format publication dates
const formatPublicationDate = (dateString?: string): string => {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  } catch {
    return '';
  }
};

export default function SearchResults({ query, results, totalHits, error, isSearching, refreshSaveStatus, groupBy = 'none' }: SearchResultsProps) {
  const [savedChunkIds, setSavedChunkIds] = useState<Set<string>>(new Set());
  
  // Function to update saved state
  const updateSavedState = useCallback(() => {
    const newSavedIds = new Set<string>();
    results.forEach(result => {
      if (result.id && isChunkSaved(result.id)) {
        newSavedIds.add(result.id);
      }
    });
    setSavedChunkIds(newSavedIds);
  }, [results]);
  
  // Load saved chunks state on mount and when results change
  useEffect(() => {
    updateSavedState();
  }, [updateSavedState]);

  // Refresh save status when triggered from parent
  useEffect(() => {
    if (refreshSaveStatus) {
      updateSavedState();
    }
  }, [refreshSaveStatus, updateSavedState]);

  const handleSaveToggle = (hit: SearchHit, event: React.MouseEvent) => {
    event.stopPropagation();

    if (!hit.id) return;

    const isSaved = savedChunkIds.has(hit.id);

    if (isSaved) {
      unsaveChunk(hit.id);
      setSavedChunkIds(prev => {
        const next = new Set(prev);
        next.delete(hit.id);
        return next;
      });
    } else {
      const chunkData = {
        id: hit.id,
        text: hit.text,
        episode_title: hit.episode_title,
        video_id: hit.video_id,
        start_formatted: hit.start_formatted,
        end_formatted: hit.start_formatted,
        podcast_name: hit.podcast_name,
        source_name: hit.source_name
      };
      saveChunk(chunkData);
      setSavedChunkIds(prev => {
        const next = new Set(prev).add(hit.id);
        return next;
      });
    }
  };


  // Group results based on groupBy option
  const groupedResults = React.useMemo(() => {
    if (groupBy === 'none') {
      return { ungrouped: results };
    }

    const groups: Record<string, SearchHit[]> = {};

    results.forEach(hit => {
      let groupKey: string;

      if (groupBy === 'episode') {
        groupKey = hit.episode_id || 'unknown';
      } else if (groupBy === 'podcast') {
        groupKey = hit.podcast_id || 'unknown';
      } else {
        groupKey = 'ungrouped';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(hit);
    });

    return groups;
  }, [results, groupBy]);

  // Get group title for display
  const getGroupTitle = (groupKey: string, hits: SearchHit[]) => {
    if (groupBy === 'episode') {
      return hits[0]?.episode_title || 'Unknown Episode';
    } else if (groupBy === 'podcast') {
      return hits[0]?.podcast_name || 'Unknown Podcast';
    }
    return '';
  };

  if (error) {
    return (
      <div className="card-primary border-red-500/30">
        <div className="text-center">
          <div className="flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>

          <h3 className="heading-secondary text-red-400 mb-2">
            {error.title}
          </h3>

          <p className="text-body mb-6">
            {error.message}
          </p>

          {error.action && (
            <button
              onClick={error.action.handler}
              className="btn-primary inline-flex items-center space-x-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{error.action.label}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isSearching) {
    return <SearchResultsSkeleton />;
  }

  if (results.length === 0) {
    return (
      <div className="empty-state">
        <div className="text-center py-8">
          <p className="text-body mb-4">No results found for "{query}"</p>
          <p className="text-meta">
            Try different keywords or broaden your filters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-6"
      role="region"
      aria-label="Search results"
      aria-live="polite"
      aria-atomic="false"
    >
      <div className="flex items-center justify-between">
        <h2
          id="results-heading"
          className="heading-primary"
        >
          Search Results
        </h2>
        <p
          className="text-body"
          aria-describedby="results-heading"
        >
          {totalHits >= 1000 ? '1000+' : totalHits} result{totalHits !== 1 ? 's' : ''} for "{query}"
        </p>
      </div>

      <div
        className="space-y-6"
        role="list"
        aria-label="Search results list"
      >
        {Object.entries(groupedResults).map(([groupKey, hits]) => (
          <div key={groupKey} className={groupBy !== 'none' ? 'space-y-4' : ''}>
            {/* Group Header */}
            {groupBy !== 'none' && (
              <div className="sticky top-0 z-10 py-2 border-b backdrop-blur-sm"
                   style={{
                     backgroundColor: 'var(--bg-primary)',
                     borderColor: 'var(--border-primary)'
                   }}>
                <h3 className="text-lg font-semibold flex items-center gap-3"
                    style={{ color: 'var(--text-primary)' }}>
                  {groupBy === 'podcast' && (() => {
                    const podcastConfig = getStaticPodcastConfig(hits[0]?.podcast_id);
                    return podcastConfig?.image ? (
                      <Image
                        src={podcastConfig.image}
                        alt={`${hits[0]?.podcast_name} icon`}
                        width={24}
                        height={24}
                        className="rounded-full flex-shrink-0"
                      />
                    ) : null;
                  })()}
                  <span>{getGroupTitle(groupKey, hits)}</span>
                  <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                    {hits.length} result{hits.length !== 1 ? 's' : ''}
                  </span>
                </h3>
              </div>
            )}

            {/* Results in this group */}
            <div className={`${groupBy !== 'none' ? 'ml-4 space-y-4' : 'space-y-4'}`}>
              {hits.map((hit, index) => (
                <article
                  key={hit.id || `${groupKey}-${index}`}
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
                          __html: DOMPurify.sanitize(hit.title_highlighted, {
                            ALLOWED_TAGS: ['mark'],
                            ALLOWED_ATTR: []
                          })
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

              {/* Podcast metadata with icon and release date */}
              <div className="flex items-center gap-3 mb-3">
                {/* Podcast icon and name */}
                <div className="flex items-center gap-2 flex-1">
                  {(() => {
                    const podcastConfig = getStaticPodcastConfig(hit.podcast_id);
                    return podcastConfig?.image ? (
                      <Image
                        src={podcastConfig.image}
                        alt={`${hit.podcast_name} icon`}
                        width={20}
                        height={20}
                        className="rounded-full flex-shrink-0"
                      />
                    ) : null;
                  })()}

                  <span className="text-meta font-medium">
                    {hit.podcast_name}
                  </span>
                </div>

                {/* Publication date */}
                {hit.publication_date && (
                  <div className="flex items-center gap-1 text-meta text-sm">
                    <Calendar className="w-3 h-3" />
                    <span>{formatPublicationDate(hit.publication_date)}</span>
                  </div>
                )}
              </div>
              
              <div className="prose max-w-none">
                    {hit.text_highlighted ? (
                      <p
                        id={`result-${groupKey}-${index}-content`}
                        className="text-body leading-relaxed [&_mark]:bg-orange-500 [&_mark]:text-white [&_mark]:px-1 [&_mark]:rounded"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(hit.text_highlighted, {
                            ALLOWED_TAGS: ['mark'],
                            ALLOWED_ATTR: []
                          })
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

                  {/* Notes section - only show if chunk is saved */}
                  {hit.id && savedChunkIds.has(hit.id) && (
                    <ChunkNotes chunkId={hit.id} />
                  )}
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
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Play className="w-4 h-4" aria-hidden="true" />
                        <span>{getWatchText(hit)}</span>
                      </a>


                      <div
                        className="flex items-center gap-1"
                        aria-label={`Timestamp: ${hit.start_formatted}`}
                      >
                        <Clock className="w-4 h-4" aria-hidden="true" />
                        <span>{hit.start_formatted}</span>
                      </div>

                      {hit.rank !== undefined && (
                        <div
                          className="flex items-center gap-1"
                          aria-label={`Search relevance: ${Math.round(hit.rank * 100)} percent`}
                        >
                          <span className="text-orange-500">
                            {Math.round(hit.rank * 100)}% relevance
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Save Button */}
                    {hit.id && (
                      <button
                        onClick={(e) => handleSaveToggle(hit, e)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 group/save ${
                          savedChunkIds.has(hit.id)
                            ? 'pill-selected text-orange-100 focus:ring-orange-500'
                            : 'pill-enhanced text-gray-200 hover:border-orange-400/30 focus:ring-gray-500'
                        }`}
                        aria-label={savedChunkIds.has(hit.id) ? 'Remove from saved' : 'Save this chunk'}
                      >
                        {savedChunkIds.has(hit.id) ? (
                          <BookmarkCheck className="w-4 h-4 group-hover/save:scale-110 transition-transform duration-200" aria-hidden="true" />
                        ) : (
                          <Bookmark className="w-4 h-4 group-hover/save:scale-110 transition-transform duration-200" aria-hidden="true" />
                        )}
                        <span>{savedChunkIds.has(hit.id) ? 'Saved' : 'Save'}</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}