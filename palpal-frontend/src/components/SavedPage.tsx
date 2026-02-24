'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Clock, Play, BookmarkX } from 'lucide-react';
import { getSavedChunks, unsaveChunk, clearSavedChunks, type SavedChunk } from '@/lib/cookies';
import ChunkNotes from '@/components/ChunkNotes';
import { getWatchUrl, getWatchText, isPatreonSource } from '@/lib/chunk-utils';

interface SavedPageProps {
  onSaveStatusChange?: () => void;
}

export default function SavedPage({ onSaveStatusChange }: SavedPageProps) {
  const [savedChunks, setSavedChunks] = useState<SavedChunk[]>([]);
  const [loading, setLoading] = useState(true);

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
              <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" />
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
                        <Play className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" aria-hidden="true" />
                        <span>{getWatchText(chunk)}</span>
                      </a>

                      <div className="flex items-center gap-2 text-meta p-1 -m-1">
                        <Clock className="w-4 h-4" aria-hidden="true" />
                        <span>{chunk.start_formatted} - {chunk.end_formatted}</span>
                      </div>

                      <div className="flex items-center gap-2 text-meta p-1 -m-1">
                        <span>Saved {formatSavedDate(chunk.savedAt)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleUnsaveChunk(chunk.id)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 text-gray-200 hover:bg-red-500/10 hover:text-red-300 group"
                      aria-label="Remove from saved"
                    >
                      <BookmarkX className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" />
                      <span>Remove</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}