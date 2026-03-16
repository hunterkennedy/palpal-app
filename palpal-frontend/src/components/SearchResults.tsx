'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { SearchHit, ErrorState } from '@/types';
import { saveChunk, unsaveChunk, isChunkSaved } from '@/lib/cookies';
import { getWatchedVideoIds } from '@/lib/watchlist';
import { SearchResultsSkeleton } from '@/components/LoadingSkeleton';
import { PodcastConfig } from '@/types/podcast';
import { GroupByOption } from '@/components/GroupByFilter';
import SearchResultCard from '@/components/SearchResultCard';

interface SearchResultsProps {
  query: string;
  results: SearchHit[];
  totalHits: number;
  error: ErrorState | null;
  isSearching: boolean;
  hasSearched: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  refreshSaveStatus?: boolean;
  groupBy?: GroupByOption;
  podcasts?: PodcastConfig[];
}


export default function SearchResults({ query, results, totalHits, error, isSearching, hasSearched, isLoadingMore, hasMore, onLoadMore, refreshSaveStatus, groupBy = 'none', podcasts }: SearchResultsProps) {
  const [savedChunkIds, setSavedChunkIds] = useState<Set<string>>(new Set());
  const [watchedVideoIds, setWatchedVideoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setWatchedVideoIds(getWatchedVideoIds());
  }, []);
  
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
      const endSecs = Math.floor(hit.end_time);
      const endFormatted = `${String(Math.floor(endSecs / 60)).padStart(2, '0')}:${String(endSecs % 60).padStart(2, '0')}`;
      const chunkData = {
        id: hit.id,
        text: hit.text,
        episode_title: hit.episode_title,
        video_id: hit.video_id,
        start_formatted: hit.start_formatted,
        end_formatted: endFormatted,
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
          {hasSearched ? (
            <>
              <p className="text-body mb-4">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-meta">Try different keywords or broaden your filters.</p>
            </>
          ) : (
            <p className="text-meta">Press Enter to search</p>
          )}
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
      <p className="text-meta" aria-live="polite">
        {totalHits >= 1000 ? '1000+' : totalHits} result{totalHits !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
      </p>

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
                    const podcastConfig = podcasts?.find(p => p.id === hits[0]?.podcast_id) ?? null;
                    return podcastConfig?.image ? (
                      <Image
                        src={podcastConfig.image}
                        alt={`${hits[0]?.podcast_name} icon`}
                        width={24}
                        height={24}
                        unoptimized
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
                <SearchResultCard
                  key={hit.id || `${groupKey}-${index}`}
                  hit={hit}
                  groupKey={groupKey}
                  index={index}
                  isSaved={hit.id ? savedChunkIds.has(hit.id) : false}
                  isWatched={hit.video_id ? watchedVideoIds.has(hit.video_id) : false}
                  onSaveToggle={handleSaveToggle}
                  podcasts={podcasts}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="flex items-center gap-2 btn-secondary px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingMore ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <span>{isLoadingMore ? 'Loading...' : 'Load more'}</span>
          </button>
        </div>
      )}
    </div>
  );
}