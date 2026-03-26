"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { X, SlidersHorizontal, Search, ChevronDown, Check } from 'lucide-react';
import { DateRange } from './SearchFilters';
import DateRangeFilter from './DateRangeFilter';
import GroupByFilter, { GroupByOption } from './GroupByFilter';
import FilterModal from './FilterModal';
import { PodcastConfig } from '@/types/podcast';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchFocus?: (inputElement: HTMLInputElement) => void;
  onSearchBlur?: () => void;
  onSearch?: (query: string) => void;
  placeholder?: string;
  className?: string;
  podcasts: PodcastConfig[];
  selectedPodcasts: string[];
  onPodcastSelectionChange: (podcasts: string[]) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onCustomDateChange?: (startDate: string, endDate: string) => void;
  groupBy: GroupByOption;
  onGroupByChange: (groupBy: GroupByOption) => void;
}

export default function SearchBar({
  searchQuery,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onSearch,
  placeholder = "Search for your favorite podcast...",
  className = '',
  podcasts,
  selectedPodcasts,
  onPodcastSelectionChange,
  dateRange,
  onDateRangeChange,
  onCustomDateChange,
  groupBy,
  onGroupByChange
}: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showPodcastDropdown, setShowPodcastDropdown] = useState(false);
  const podcastDropdownRef = useRef<HTMLDivElement>(null);
  const [customStartDate, setCustomStartDate] = useState(searchParams?.get('startDate') || '');
  const [customEndDate, setCustomEndDate] = useState(searchParams?.get('endDate') || '');

  useEffect(() => {
    const startDate = searchParams?.get('startDate');
    const endDate = searchParams?.get('endDate');
    if (startDate) setCustomStartDate(startDate);
    if (endDate) setCustomEndDate(endDate);
  }, [searchParams]);

  // Close podcast dropdown on click-outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (podcastDropdownRef.current && !podcastDropdownRef.current.contains(event.target as Node)) {
        setShowPodcastDropdown(false);
      }
    };
    if (showPodcastDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPodcastDropdown]);

  const enabledPodcasts = podcasts.filter(p => p.enabled);
  const allIds = enabledPodcasts.map(p => p.id);
  const isAllMode = selectedPodcasts.length === 0 || selectedPodcasts.length === allIds.length;
  const selectedPod = selectedPodcasts.length === 1
    ? enabledPodcasts.find(p => p.id === selectedPodcasts[0])
    : null;

  const handlePodcastSelect = (podcastId: string) => {
    if (isAllMode) {
      onPodcastSelectionChange([podcastId]);
    } else {
      const isSelected = selectedPodcasts.includes(podcastId);
      const newSelection = isSelected
        ? selectedPodcasts.filter(id => id !== podcastId)
        : [...selectedPodcasts, podcastId];
      onPodcastSelectionChange(newSelection);
    }
  };

  const handleAllSelect = () => {
    onPodcastSelectionChange([]);
    setShowPodcastDropdown(false);
  };

  const chipLabel = isAllMode
    ? 'All shows'
    : selectedPod
      ? selectedPod.displayName
      : `${selectedPodcasts.length} shows`;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  const handleClearSearch = () => {
    onSearchChange('');
  };

  const handleApplyFilters = (filters: {
    selectedPodcasts: string[];
    dateRange: DateRange;
    groupBy: GroupByOption;
    customStartDate: string;
    customEndDate: string;
  }) => {
    onPodcastSelectionChange(filters.selectedPodcasts);
    onDateRangeChange(filters.dateRange);
    onGroupByChange(filters.groupBy);
    if (filters.dateRange === 'custom') {
      handleCustomDateChange(filters.customStartDate, filters.customEndDate);
    }
  };

  const handleCustomDateChange = (startDate: string, endDate: string) => {
    setCustomStartDate(startDate);
    setCustomEndDate(endDate);
    const newSearchParams = new URLSearchParams(searchParams?.toString());
    newSearchParams.set('startDate', startDate);
    newSearchParams.set('endDate', endDate);
    router.push(`?${newSearchParams.toString()}`);
    if (onCustomDateChange) {
      onCustomDateChange(startDate, endDate);
    }
  };

  const enabledPodcastCount = podcasts.filter(p => p.enabled).length;
  const isPodcastFiltered = selectedPodcasts.length > 0 && selectedPodcasts.length < enabledPodcastCount;
  const hasActiveFilters = isPodcastFiltered || dateRange !== 'all' || groupBy !== 'none';

  return (
    <div className={`relative z-50 ${className}`}>

      {/* ── Desktop filter row (sort/date/groupby only) ── */}
      <div className="hidden md:flex items-center justify-end gap-3 mb-5 max-w-4xl mx-auto">
        <div
          className="flex items-center gap-1 px-2 py-1.5 rounded-2xl"
          style={{
            background: 'var(--surface-secondary)',
            border: '1px solid var(--border-secondary)',
          }}
        >
          <DateRangeFilter
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
            onCustomDateChange={handleCustomDateChange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
          />
          <div className="w-px h-4 mx-1 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <GroupByFilter
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
          />
        </div>
      </div>

      {/* ── Mobile filter button ── */}
      <div className="md:hidden mb-4 max-w-4xl mx-auto">
        <button
          onClick={() => setShowFilterModal(true)}
          className="relative w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all duration-200"
          style={{
            background: hasActiveFilters
              ? 'rgba(255,140,66,0.08)'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${hasActiveFilters ? 'rgba(255,140,66,0.3)' : 'rgba(255,255,255,0.08)'}`,
            color: hasActiveFilters ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
          aria-label="Open filters"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>{hasActiveFilters ? 'Filters active' : 'Filters'}</span>
          {hasActiveFilters && (
            <span
              className="w-1.5 h-1.5 rounded-full absolute top-2.5 right-3"
              style={{ background: 'var(--accent-primary)' }}
            />
          )}
        </button>
      </div>

      {/* ── Search capsule + podcast dropdown wrapper ── */}
      <div className="relative max-w-4xl mx-auto" ref={podcastDropdownRef}>
        <form onSubmit={handleSearchSubmit}>
          <div
            className="search-bar-enhanced flex items-center rounded-[28px] overflow-hidden"
            style={{ minHeight: '72px' }}
          >
            {/* Search icon */}
            <div className="pl-6 pr-3 flex-shrink-0 pointer-events-none">
              <Search
                className="w-5 h-5 transition-colors duration-200"
                style={{ color: searchQuery ? 'var(--accent-primary)' : 'var(--text-subtle)' }}
              />
            </div>

            {/* Scope chip — desktop only */}
            <button
              type="button"
              onClick={() => setShowPodcastDropdown(v => !v)}
              className="hidden md:flex items-center gap-1.5 flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200"
              style={{
                background: !isAllMode ? 'rgba(254,133,0,0.12)' : 'var(--surface-elevated)',
                border: `1px solid ${!isAllMode ? 'rgba(254,133,0,0.35)' : 'var(--border-secondary)'}`,
                color: !isAllMode ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              {selectedPod?.image && (
                <Image
                  src={selectedPod.image}
                  alt={selectedPod.displayName}
                  width={16}
                  height={16}
                  unoptimized
                  className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                />
              )}
              <span className="max-w-[140px] truncate">{chipLabel}</span>
              <ChevronDown
                className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                style={{ transform: showPodcastDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            {/* Divider between chip and input — desktop only */}
            <div
              className="hidden md:block w-px h-6 mx-3 flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.12)' }}
            />

            {/* Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={(e) => onSearchFocus?.(e.target)}
              onBlur={onSearchBlur}
              placeholder={placeholder}
              className="flex-1 bg-transparent py-5 text-lg font-medium outline-none min-w-0"
              style={{ color: 'var(--text-primary)' }}
              enterKeyHint="search"
            />

            {/* Clear button */}
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="flex-shrink-0 p-2 mx-1 rounded-full transition-all duration-150"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Submit */}
            <button
              type="submit"
              className="flex items-center gap-2.5 px-7 self-stretch flex-shrink-0 font-semibold text-sm tracking-wide transition-all duration-200"
              style={{
                background: 'var(--surface-primary)',
                color: 'var(--accent-primary)',
                borderLeft: '1px solid rgba(254, 133, 0, 0.6)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-elevated)';
                (e.currentTarget as HTMLButtonElement).style.borderLeftColor = 'rgba(254, 133, 0, 0.8)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-primary)';
                (e.currentTarget as HTMLButtonElement).style.borderLeftColor = 'rgba(254, 133, 0, 0.6)';
              }}
              aria-label="Search"
            >
              <Search className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">Search</span>
            </button>
          </div>
        </form>

        {/* ── Podcast dropdown panel ── */}
        {showPodcastDropdown && (
          <div
            className="absolute top-full left-0 right-0 mt-3 rounded-2xl overflow-hidden z-50"
            style={{
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* All shows */}
            <PodcastOption
              isSelected={isAllMode}
              onClick={handleAllSelect}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--surface-elevated)' }}
              >
                <Search className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </div>
              <div>
                <div className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                  All shows
                </div>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Search across everything
                </div>
              </div>
              {isAllMode && (
                <Check className="w-4 h-4 ml-auto flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
              )}
            </PodcastOption>

            <div style={{ height: '1px', background: 'var(--border-secondary)' }} />

            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
            {enabledPodcasts.map((podcast, i) => {
              const isSelected = !isAllMode && selectedPodcasts.includes(podcast.id);
              return (
                <React.Fragment key={podcast.id}>
                  <PodcastOption
                    isSelected={isSelected}
                    onClick={() => handlePodcastSelect(podcast.id)}
                  >
                    <div
                      className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                      style={{ background: 'var(--surface-elevated)' }}
                    >
                      {podcast.image ? (
                        <Image
                          src={podcast.image}
                          alt={podcast.displayName}
                          width={48}
                          height={48}
                          unoptimized
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xl font-bold" style={{ color: 'var(--text-muted)' }}>
                          {podcast.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                      {podcast.displayName}
                    </span>
                    {isSelected && (
                      <Check className="w-4 h-4 ml-auto flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    )}
                  </PodcastOption>
                  {i < enabledPodcasts.length - 1 && (
                    <div style={{ height: '1px', background: 'var(--border-secondary)', opacity: 0.5 }} />
                  )}
                </React.Fragment>
              );
            })}
            </div>
          </div>
        )}
      </div>

      {/* Filter Modal (mobile) */}
      <FilterModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        podcasts={podcasts}
        selectedPodcasts={selectedPodcasts}
        dateRange={dateRange}
        groupBy={groupBy}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onApplyFilters={handleApplyFilters}
        onCustomDateChange={handleCustomDateChange}
      />
    </div>
  );
}

function PodcastOption({
  isSelected,
  onClick,
  children,
}: {
  isSelected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors duration-150"
      style={{
        background: isSelected
          ? 'rgba(254,133,0,0.08)'
          : hovered
            ? 'rgba(255,255,255,0.04)'
            : 'transparent',
        borderLeft: `3px solid ${isSelected ? 'var(--accent-primary)' : 'transparent'}`,
      }}
    >
      {children}
    </button>
  );
}
