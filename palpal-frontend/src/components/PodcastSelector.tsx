"use client";

import React from 'react';
import Image from 'next/image';
import { PodcastConfig } from '@/types/podcast';

interface PodcastSelectorProps {
  podcasts: PodcastConfig[];
  selectedPodcasts: string[];
  onSelectionChange: (podcasts: string[]) => void;
  className?: string;
}

function PodcastAvatar({ podcast, isActive }: { podcast: PodcastConfig; isActive: boolean }) {
  if (podcast.image) {
    return (
      <Image
        src={podcast.image}
        alt={podcast.displayName}
        width={32}
        height={32}
        unoptimized
        className="w-full h-full object-cover"
      />
    );
  }
  return (
    <span
      className="text-xs font-bold"
      style={{ color: isActive ? 'var(--accent-light)' : 'var(--text-muted)' }}
    >
      {podcast.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

export default function PodcastSelector({
  podcasts,
  selectedPodcasts,
  onSelectionChange,
  className = ''
}: PodcastSelectorProps) {
  const enabledPodcasts = podcasts.filter(p => p.enabled);
  const allIds = enabledPodcasts.map(p => p.id);
  const isAllMode = selectedPodcasts.length === 0 || selectedPodcasts.length === allIds.length;

  const handleAllClick = () => {
    if (!isAllMode) onSelectionChange(allIds);
  };

  const handlePodcastClick = (podcastId: string) => {
    const isExclusive = selectedPodcasts.length === 1 && selectedPodcasts[0] === podcastId;
    onSelectionChange(isExclusive ? allIds : [podcastId]);
  };

  if (enabledPodcasts.length === 0) return null;

  return (
    <div className={`overflow-x-auto flex-shrink-0 ${className}`}>
      <div className="flex items-center gap-2 flex-nowrap">

        {/* All option */}
        <button
          onClick={handleAllClick}
          title="All podcasts"
          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold transition-all duration-200"
          style={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-primary)',
            color: isAllMode ? 'var(--accent-light)' : 'var(--text-muted)',
            opacity: isAllMode ? 1 : 0.35,
            boxShadow: isAllMode ? '0 0 0 2px var(--accent-primary), 0 0 8px rgba(254,133,0,0.4)' : undefined,
          }}
          onMouseEnter={e => { if (!isAllMode) (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
          onMouseLeave={e => { if (!isAllMode) (e.currentTarget as HTMLElement).style.opacity = '0.35'; }}
        >
          All
        </button>

        {/* Podcast icon avatars */}
        {enabledPodcasts.map(podcast => {
          const isSelected = !isAllMode && selectedPodcasts.includes(podcast.id);
          const active = isAllMode || isSelected;
          return (
            <button
              key={podcast.id}
              onClick={() => handlePodcastClick(podcast.id)}
              title={podcast.displayName}
              className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center transition-all duration-200"
              style={{
                background: podcast.image ? undefined : 'var(--surface-elevated)',
                border: podcast.image ? undefined : '1px solid var(--border-primary)',
                opacity: active ? 1 : 0.35,
                boxShadow: isSelected
                  ? '0 0 0 2px var(--accent-primary), 0 0 8px rgba(254,133,0,0.4)'
                  : undefined,
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.opacity = active ? '1' : '0.35'; }}
            >
              <PodcastAvatar podcast={podcast} isActive={active} />
            </button>
          );
        })}

      </div>
    </div>
  );
}
