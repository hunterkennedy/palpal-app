"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import { X, Search, SlidersHorizontal } from 'lucide-react';
import { SortOption, DateRange } from './SearchFilters';
import PodcastDropdown from './PodcastDropdown';
import SortFilter, { SortDirection } from './SortFilter';
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
  // Podcast selector props
  podcasts: PodcastConfig[];
  selectedPodcasts: string[];
  onPodcastSelectionChange: (podcasts: string[]) => void;
  // Filter props
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (direction: SortDirection) => void;
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
  sortBy,
  onSortChange,
  sortDirection,
  onSortDirectionChange,
  dateRange,
  onDateRangeChange,
  onCustomDateChange,
  groupBy,
  onGroupByChange
}: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [customStartDate, setCustomStartDate] = useState(searchParams?.get('startDate') || '');
  const [customEndDate, setCustomEndDate] = useState(searchParams?.get('endDate') || '');

  useEffect(() => {
    const startDate = searchParams?.get('startDate');
    const endDate = searchParams?.get('endDate');
    if (startDate) {
      setCustomStartDate(startDate);
    }
    if (endDate) {
      setCustomEndDate(endDate);
    }
  }, [searchParams]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    onSearchChange(query);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  const handleClearSearch = () => {
    onSearchChange('');
  };

  const openFilterModal = () => {
    setShowFilterModal(true);
  };

  const handleApplyFilters = (filters: {
    selectedPodcasts: string[];
    sortBy: SortOption;
    sortDirection: SortDirection;
    dateRange: DateRange;
    groupBy: GroupByOption;
    customStartDate: string;
    customEndDate: string;
  }) => {
    onPodcastSelectionChange(filters.selectedPodcasts);
    onSortChange(filters.sortBy);
    onSortDirectionChange(filters.sortDirection);
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

  const activeFilterCount = selectedPodcasts.length;

  return (
    <div className={`transition-all duration-700 ease-out opacity-100 transform translate-y-0 relative z-50 ${className}`}>
      {/* Desktop: Top Controls Row */}
      <div className="hidden md:flex items-center gap-4 mb-4 max-w-4xl mx-auto">
        {/* Left: Podcast Selector */}
        <PodcastDropdown
          podcasts={podcasts}
          selectedPodcasts={selectedPodcasts}
          onSelectionChange={onPodcastSelectionChange}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: Individual Filter Components */}
        <div className="flex items-center gap-3">
          <SortFilter
            sortBy={sortBy}
            onSortChange={onSortChange}
            sortDirection={sortDirection}
            onSortDirectionChange={onSortDirectionChange}
          />

          <DateRangeFilter
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
            onCustomDateChange={handleCustomDateChange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
          />

          <GroupByFilter
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
          />
        </div>
      </div>

      {/* Mobile: Clean Filter Button */}
      <div className="md:hidden mb-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-center">
          <button
            onClick={openFilterModal}
            className="relative flex items-center gap-2 btn-secondary px-4 py-3 text-sm font-medium"
            aria-label="Open filters"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="relative max-w-4xl mx-auto">
        <div className="search-orb absolute left-7 top-1/2 transform -translate-y-1/2 w-7 h-7 rounded-full bg-orange-500 shadow-2xl shadow-orange-400/100 ring-2 ring-orange-300/100 border-2 border-orange-400 flex items-center justify-center">
          <Search className="w-4 h-4 text-white" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          onFocus={(e) => onSearchFocus?.(e.target)}
          onBlur={onSearchBlur}
          placeholder={placeholder}
          className="search-bar-enhanced w-full pl-20 pr-20 py-7 text-xl font-medium rounded-3xl text-white placeholder-gray-400 transition-all duration-300"
          disabled={false}
          enterKeyHint="search"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="absolute right-7 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-orange-300 transition-all duration-200 p-2.5 rounded-full hover:bg-orange-400/10 group"
            aria-label="Clear search"
          >
            <X className="w-6 h-6 group-hover:scale-110 transition-transform duration-200" />
          </button>
        )}
      </form>

      {/* Filter Modal */}
      <FilterModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        podcasts={podcasts}
        selectedPodcasts={selectedPodcasts}
        sortBy={sortBy}
        sortDirection={sortDirection}
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
