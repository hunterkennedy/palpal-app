'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, Clock, Play, BookmarkX, ChevronDown, Loader2 } from 'lucide-react';
import { getSavedChunks, unsaveChunk, clearSavedChunks, type SavedChunk } from '@/lib/cookies';
import ChunkNotes from '@/components/ChunkNotes';
import ChunkContextView from '@/components/ChunkContextView';
import { getWatchUrl, getWatchText, isPatreonSource } from '@/lib/chunk-utils';
import { ConductorChunk } from '@/lib/conductor';

interface ContextData {
  chunks: ConductorChunk[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

interface ChunkContextState {
  expanded: boolean;
  loading: boolean;
  data: ContextData | null;
  radius: number;
  failed: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SavedPageProps {
  onSaveStatusChange?: () => void;
}

export default function SavedPage({ onSaveStatusChange }: SavedPageProps) {
  const [savedChunks, setSavedChunks] = useState<SavedChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [contextStates, setContextStates] = useState<Record<string, ChunkContextState>>({});

  const getContextState = (chunkId: string): ChunkContextState =>
    contextStates[chunkId] ?? { expanded: false, loading: false, data: null, radius: 2, failed: false };

  const fetchContext = useCallback(async (chunkId: string, radius: number) => {
    const defaultState: ChunkContextState = { expanded: false, loading: false, data: null, radius: 2, failed: false };
    setContextStates(prev => ({
      ...prev,
      [chunkId]: { ...(prev[chunkId] ?? defaultState), loading: true, failed: false },
    }));
    try {
      const res = await fetch(`/api/chunks?chunkId=${encodeURIComponent(chunkId)}&radius=${radius}`);
      if (!res.ok) throw new Error('Failed');
      const data: ContextData = await res.json();
      setContextStates(prev => {
        const cur = prev[chunkId];
        let next = data;
        if (cur?.data && radius > 2) {
          const prevFirstId = cur.data.chunks[0]?.id;
          const prevLastId = cur.data.chunks[cur.data.chunks.length - 1]?.id;
          next = {
            ...data,
            hasMoreBefore: data.hasMoreBefore && data.chunks[0]?.id !== prevFirstId,
            hasMoreAfter: data.hasMoreAfter && data.chunks[data.chunks.length - 1]?.id !== prevLastId,
          };
        }
        return { ...prev, [chunkId]: { ...cur, loading: false, data: next, radius, failed: false } };
      });
    } catch {
      setContextStates(prev => ({
        ...prev,
        [chunkId]: { ...prev[chunkId], loading: false, failed: true },
      }));
    }
  }, []);

  const handleToggleContext = (chunkId: string) => {
    const cur = getContextState(chunkId);
    if (cur.expanded) {
      setContextStates(prev => ({ ...prev, [chunkId]: { ...cur, expanded: false } }));
    } else {
      setContextStates(prev => ({ ...prev, [chunkId]: { ...cur, expanded: true } }));
      if (!cur.data) fetchContext(chunkId, cur.radius);
    }
  };

  const handleLoadMore = (chunkId: string) => {
    const cur = getContextState(chunkId);
    const newRadius = cur.radius + 2;
    setContextStates(prev => ({ ...prev, [chunkId]: { ...cur, radius: newRadius } }));
    fetchContext(chunkId, newRadius);
  };

  // Load saved chunks when component mounts
  useEffect(() => {
    setLoading(true);
    const chunks = getSavedChunks();
    setSavedChunks(chunks);
    setLoading(false);
  }, []);

  const handleUnsaveChunk = (chunkId: string) => {
    unsaveChunk(chunkId);
    setSavedChunks(prev => prev.filter(chunk => chunk.id !== chunkId));
    onSaveStatusChange?.();
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all saved chunks? This cannot be undone.')) {
      clearSavedChunks();
      setSavedChunks([]);
      onSaveStatusChange?.();
    }
  };

  const formatSavedDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-12">
        <h1 className="heading-primary">
          Saved Chunks
        </h1>
        <div className="flex items-center justify-between">
          <p className="text-xl text-body">
            {savedChunks.length} saved chunk{savedChunks.length !== 1 ? 's' : ''} stored locally in your browser
          </p>
          {savedChunks.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all duration-300 text-gray-200 hover:bg-red-500/10 hover:text-red-300 group"
            >
              <Trash2 className="w-4 h-4 " />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="section-container">
        {loading ? (
          <section>
            <div className="card-primary text-center">
              <div className="spinner"></div>
              <p className="text-body">Loading saved chunks...</p>
            </div>
          </section>
        ) : savedChunks.length === 0 ? (
          <section>
            <div className="card-primary text-center">
              <BookmarkX className="w-20 h-20 text-gray-500 mx-auto mb-6" />
              <h2 className="heading-secondary">No saved chunks yet</h2>
              <p className="text-body max-w-lg mx-auto">
                Save your favorite podcast moments by clicking the "Save" button on search results.
                They'll be stored locally in your browser for easy access.
              </p>
            </div>
          </section>
        ) : (
          <section>
            <div className="space-y-6">
              {savedChunks.map((chunk, index) => (
                <article
                  key={chunk.id}
                  className="card-primary"
                >
                  {/* Chunk Header */}
                  <div className="mb-4">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="heading-secondary flex-1 mr-4">
                        {chunk.episode_title}
                      </h3>
                      <div className="text-meta font-mono">
                        #{String(index + 1).padStart(2, '0')}
                      </div>
                    </div>

                    <div className="card-secondary">
                      <p className="text-body">
                        {chunk.text}
                      </p>

                      {/* Notes section */}
                      <ChunkNotes chunkId={chunk.id} />
                    </div>
                  </div>

                  {/* Chunk Actions */}
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex flex-wrap gap-4">
                      <a
                        href={getWatchUrl(chunk)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 rounded-md p-1 -m-1 font-medium text-sm group ${
                          isPatreonSource(chunk)
                            ? 'text-orange-400 hover:text-orange-300 focus:ring-orange-500'
                            : 'text-red-400 hover:text-red-300 focus:ring-red-500'
                        }`}
                        aria-label={`${getWatchText(chunk).replace('Watch on ', `Watch "${chunk.episode_title}" on `)}`}
                      >
                        <Play className="w-4 h-4 " aria-hidden="true" />
                        <span>{getWatchText(chunk)}</span>
                      </a>

                      <div className="flex items-center gap-2 text-meta p-1 -m-1">
                        <Clock className="w-4 h-4" aria-hidden="true" />
                        <span>{chunk.start_formatted}{chunk.end_formatted ? ` - ${chunk.end_formatted}` : ''}</span>
                      </div>

                      <div className="flex items-center gap-2 text-meta p-1 -m-1">
                        <span>Saved {formatSavedDate(chunk.savedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Context button */}
                      {(() => {
                        const hasValidId = chunk.id && UUID_RE.test(chunk.id);
                        const ctx = getContextState(chunk.id);
                        if (!hasValidId) {
                          return (
                            <span
                              title="Context unavailable — this chunk may have been re-indexed or saved without a valid chunk ID"
                              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm cursor-not-allowed select-none opacity-40"
                              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-primary)' }}
                            >
                              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Context</span>
                            </span>
                          );
                        }
                        return (
                          <button
                            onClick={() => handleToggleContext(chunk.id)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-gray-500 pill-enhanced"
                            style={{ color: 'var(--text-muted)' }}
                            aria-label={ctx.expanded ? 'Hide context' : 'Show context'}
                            aria-expanded={ctx.expanded}
                          >
                            {ctx.loading && !ctx.expanded ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform duration-200 ${ctx.expanded ? 'rotate-180' : ''}`}
                                aria-hidden="true"
                              />
                            )}
                            <span>Context</span>
                          </button>
                        );
                      })()}

                      <button
                        onClick={() => handleUnsaveChunk(chunk.id)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 text-gray-200 hover:bg-red-500/10 hover:text-red-300 group"
                        aria-label="Remove from saved"
                      >
                        <BookmarkX className="w-4 h-4 " />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>

                  {/* Inline context */}
                  {(() => {
                    const ctx = getContextState(chunk.id);
                    if (!ctx.expanded) return null;
                    if (ctx.loading && !ctx.data) {
                      return (
                        <div
                          className="mt-4 border-t pt-4 flex items-center justify-center py-6"
                          style={{ borderColor: 'var(--border-primary)' }}
                        >
                          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
                        </div>
                      );
                    }
                    if (ctx.failed) {
                      return (
                        <div
                          className="mt-4 border-t pt-4 text-sm text-center"
                          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
                        >
                          Context unavailable — this chunk may have been re-indexed since it was saved.
                        </div>
                      );
                    }
                    if (ctx.data) {
                      return (
                        <ChunkContextView
                          chunks={ctx.data.chunks}
                          matchedChunkId={chunk.id}
                          hasMoreBefore={ctx.data.hasMoreBefore}
                          hasMoreAfter={ctx.data.hasMoreAfter}
                          isLoading={ctx.loading}
                          onLoadMore={() => handleLoadMore(chunk.id)}
                        />
                      );
                    }
                    return null;
                  })()}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}