"use client";

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { ChevronDown, X, Search } from 'lucide-react';
import { PodcastConfig } from '@/types/podcast';

interface PodcastDropdownProps {
  podcasts: PodcastConfig[];
  selectedPodcasts: string[];
  onSelectionChange: (podcasts: string[]) => void;
  className?: string;
}

export default function PodcastDropdown({
  podcasts,
  selectedPodcasts,
  onSelectionChange,
  className = ''
}: PodcastDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const enabledPodcasts = podcasts.filter(p => p.enabled);
  const filteredPodcasts = enabledPodcasts.filter(podcast =>
    podcast.displayName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const togglePodcast = (podcastId: string) => {
    const newSelection = selectedPodcasts.includes(podcastId)
      ? selectedPodcasts.filter(id => id !== podcastId)
      : [...selectedPodcasts, podcastId];
    onSelectionChange(newSelection);
  };

  const getDisplayText = () => {
    if (selectedPodcasts.length === 0) {
      return 'Searching all...';
    }
    // For selections, we'll show icons only - no text needed
    return null;
  };

  const getSelectedPodcastImages = () => {
    if (selectedPodcasts.length === 0) return [];
    return selectedPodcasts
      .map(id => podcasts.find(p => p.id === id))
      .filter((p): p is PodcastConfig => !!p)
      .slice(0, 4); // Show max 4 larger images
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange([]);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Wider Stable Container - 52 units total for high priority component */}
      <div className="flex w-52 h-10">
        {/* Main Dropdown Button - Always same width */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`filter-trigger flex items-center gap-3 px-4 py-2 rounded-l-lg h-10 w-40 ${selectedPodcasts.length > 0 ? 'is-active' : ''}`}
        >
          {/* Icons Section - Larger, more prominent */}
          <div className="flex items-center justify-start flex-shrink-0">
            {getSelectedPodcastImages().length > 0 ? (
              <div className="flex -space-x-2">
                {getSelectedPodcastImages().slice(0, 4).map((podcast, index) => (
                  <Image
                    key={podcast.id}
                    src={podcast.image}
                    alt={podcast.displayName}
                    width={24}
                    height={24}
                    unoptimized
                    className="w-6 h-6 rounded-full object-cover"
                    style={{ border: '2px solid var(--bg-secondary)', zIndex: getSelectedPodcastImages().length - index }}
                  />
                ))}
                {selectedPodcasts.length > 4 && (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent-primary)', color: 'var(--bg-tertiary)', border: '2px solid var(--bg-secondary)', zIndex: 0 }}>
                    +{selectedPodcasts.length - 4}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-primary)' }}>
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>All</span>
              </div>
            )}
          </div>

          {/* Text Section - Only show when no selections */}
          {getDisplayText() && (
            <span className="text-sm font-medium truncate flex-1 text-left min-w-0">{getDisplayText()}</span>
          )}

          {/* Spacer when no text - pushes chevron to right */}
          {!getDisplayText() && <div className="flex-1" />}

          {/* Chevron - Always in clickable main button */}
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Clear Button Area - Always visible, stable layout */}
        <div className="filter-trigger flex items-center justify-center px-3 py-2 border-l-0 rounded-r-lg w-12 h-10">
          {selectedPodcasts.length > 0 ? (
            <button
              onClick={clearSelection}
              className="flex items-center justify-center w-full h-full hover:bg-white/10 rounded transition-colors"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            /* Empty space when no selections - maintains layout */
            <div className="w-4 h-4" />
          )}
        </div>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="filter-dropdown absolute top-full mt-1 right-0 w-72 rounded-lg z-[99999] max-h-80 overflow-hidden">
          {/* Search Input */}
          <div className="p-2.5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search podcasts..."
                className="w-full pl-9 pr-8 py-2 rounded-md text-sm focus:outline-none transition-colors"
                style={{
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                }}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 px-2.5 py-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <button
              onClick={() => onSelectionChange(enabledPodcasts.map(p => p.id))}
              className="px-3 py-1 text-xs rounded-md transition-colors"
              style={{ background: 'rgba(255,140,66,0.15)', color: 'var(--accent-primary)' }}
            >
              Select All
            </button>
            <button
              onClick={() => onSelectionChange([])}
              className="px-3 py-1 text-xs rounded-md transition-colors"
              style={{ background: 'var(--surface-primary)', color: 'var(--text-muted)', border: '1px solid var(--border-primary)' }}
            >
              Clear All
            </button>
          </div>

          {/* Podcast List */}
          <div className="max-h-48 overflow-y-auto">
            {filteredPodcasts.length === 0 ? (
              <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                No podcasts found
              </div>
            ) : (
              filteredPodcasts.map((podcast) => {
                const isSelected = selectedPodcasts.includes(podcast.id);
                return (
                  <button
                    key={podcast.id}
                    onClick={() => togglePodcast(podcast.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                      isSelected ? 'filter-option-selected' : 'filter-option'
                    }`}
                  >
                    <Image
                      src={podcast.image}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                    <span className="text-sm font-medium flex-1 text-left truncate">
                      {podcast.displayName}
                    </span>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                        <div className="w-2 h-2 bg-white rounded-full" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}