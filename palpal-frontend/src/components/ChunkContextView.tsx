'use client';

import React from 'react';
import { Clock, ChevronUp, ChevronDown, Loader2, Play } from 'lucide-react';
import { ConductorChunk } from '@/lib/conductor';
import { getWatchUrl, isPatreonSource } from '@/lib/chunk-utils';

interface ChunkContextViewProps {
  chunks: ConductorChunk[];
  matchedChunkId: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}

export default function ChunkContextView({
  chunks,
  matchedChunkId,
  hasMoreBefore,
  hasMoreAfter,
  isLoading,
  onLoadMore,
}: ChunkContextViewProps) {
  return (
    <div
      className="mt-4 border-t pt-4"
      style={{ borderColor: 'var(--border-primary)' }}
      onClick={e => e.stopPropagation()}
    >
      {hasMoreBefore && (
        <button
          onClick={() => onLoadMore()}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 py-2 mb-3 text-sm rounded-lg transition-colors disabled:opacity-50 hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
          <span>Earlier in episode</span>
        </button>
      )}

      <div className="space-y-1.5">
        {chunks.map(chunk => {
          const isMatched = chunk.id === matchedChunkId;
          return (
            <div
              key={chunk.id}
              className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${isMatched ? 'border-l-2' : ''}`}
              style={
                isMatched
                  ? {
                      backgroundColor: 'rgba(254, 133, 0, 0.08)',
                      borderLeftColor: 'var(--accent-primary)',
                      color: 'var(--text-secondary)',
                    }
                  : {
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-secondary)',
                    }
              }
            >
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1">{chunk.text}</p>
                <a
                  href={getWatchUrl(chunk)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 flex items-center gap-1 text-xs mt-0.5 transition-opacity hover:opacity-80"
                  style={{
                    color: isPatreonSource(chunk) ? 'var(--accent-primary)' : '#ef4444',
                  }}
                >
                  <Play className="w-3 h-3" />
                  <Clock className="w-3 h-3" />
                  <span>{chunk.start_formatted}</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {hasMoreAfter && (
        <button
          onClick={() => onLoadMore()}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 py-2 mt-3 text-sm rounded-lg transition-colors disabled:opacity-50 hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <span>Later in episode</span>
        </button>
      )}
    </div>
  );
}
