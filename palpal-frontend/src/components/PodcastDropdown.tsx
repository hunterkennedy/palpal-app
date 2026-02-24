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
          className="flex items-center gap-3 px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-l-lg text-white transition-all duration-200 h-10 w-40"
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
                    className="w-6 h-6 rounded-full border-2 border-gray-700 object-cover"
                    style={{ zIndex: getSelectedPodcastImages().length - index }}
                  />
                ))}
                {selectedPodcasts.length > 4 && (
                  <div className="w-6 h-6 rounded-full bg-orange-600 border-2 border-gray-700 flex items-center justify-center text-xs font-bold text-white" style={{ zIndex: 0 }}>
                    +{selectedPodcasts.length - 4}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center">
                <span className="text-xs font-bold text-gray-300">All</span>
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
        <div className="flex items-center justify-center px-3 py-2 bg-white/10 border border-l-0 border-white/20 rounded-r-lg text-white transition-all duration-200 w-12 h-10">
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
        <div className="absolute top-full mt-1 right-0 w-72 rounded-lg shadow-xl z-[99999] max-h-80 overflow-hidden" style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
          backdropFilter: 'blur(16px)',
          border: '2px solid rgba(255, 255, 255, 0.1)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 4px 24px rgba(0, 0, 0, 0.3)'
        }}>
          {/* Search Input */}
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search podcasts..."
                className="w-full pl-10 pr-10 py-2 bg-white/5 border border-white/20 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-orange-400 transition-colors"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="p-2 border-b border-gray-700 flex gap-2">
            <button
              onClick={() => onSelectionChange(enabledPodcasts.map(p => p.id))}
              className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors"
            >
              Select All
            </button>
            <button
              onClick={() => onSelectionChange([])}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
            >
              Clear All
            </button>
          </div>

          {/* Podcast List */}
          <div className="max-h-48 overflow-y-auto">
            {filteredPodcasts.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">
                No podcasts found
              </div>
            ) : (
              filteredPodcasts.map((podcast) => {
                const isSelected = selectedPodcasts.includes(podcast.id);
                return (
                  <button
                    key={podcast.id}
                    onClick={() => togglePodcast(podcast.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors ${
                      isSelected ? 'bg-orange-900/30' : ''
                    }`}
                  >
                    <Image
                      src={podcast.image}
                      alt=""
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                    <span className="text-white text-sm font-medium flex-1 text-left truncate">
                      {podcast.displayName}
                    </span>
                    {isSelected && (
                      <div className="w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
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