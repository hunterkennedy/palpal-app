"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Calendar, SortAsc, Filter } from 'lucide-react';

export type SortOption = 'relevance' | 'date' | 'duration';
export type DateRange = 'all' | 'last_week' | 'last_month' | 'last_3_months' | 'last_year' | 'custom';

interface SearchFiltersProps {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onePerEpisode: boolean;
  onOnePerEpisodeChange: (enabled: boolean) => void;
  className?: string;
}

export default function SearchFilters({
  sortBy,
  onSortChange,
  dateRange,
  onDateRangeChange,
  onePerEpisode,
  onOnePerEpisodeChange,
  className = ''
}: SearchFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const sortOptions = [
    { value: 'relevance' as SortOption, label: 'Relevance', icon: SortAsc },
    { value: 'date' as SortOption, label: 'Date', icon: Calendar },
    { value: 'duration' as SortOption, label: 'Duration', icon: SortAsc }
  ];

  const dateOptions = [
    { value: 'all' as DateRange, label: 'All time' },
    { value: 'last_week' as DateRange, label: 'Last week' },
    { value: 'last_month' as DateRange, label: 'Last month' },
    { value: 'last_3_months' as DateRange, label: 'Last 3 months' },
    { value: 'last_year' as DateRange, label: 'Last year' }
  ];

  const getActiveFiltersCount = () => {
    let count = 0;
    if (sortBy !== 'relevance') count++;
    if (dateRange !== 'all') count++;
    if (onePerEpisode) count++;
    return count;
  };

  const activeCount = getActiveFiltersCount();

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Filter Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg text-white transition-all duration-200"
      >
        <Filter className="w-4 h-4" />
        <span className="text-sm font-medium">Filters</span>
        {activeCount > 0 && (
          <span className="bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {activeCount}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full mt-1 left-0 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-[99999]">
          <div className="p-4 space-y-6">
            {/* Sort By */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Sort by</label>
              <div className="space-y-2">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onSortChange(option.value)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                      sortBy === option.value
                        ? 'bg-orange-600 text-white'
                        : 'hover:bg-gray-800 text-gray-300'
                    }`}
                  >
                    <option.icon className="w-4 h-4" />
                    <span className="text-sm">{option.label}</span>
                    {sortBy === option.value && option.value !== 'relevance' && (
                      <span className="ml-auto text-xs opacity-75">(active)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Date range</label>
              <div className="space-y-2">
                {dateOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onDateRangeChange(option.value)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                      dateRange === option.value
                        ? 'bg-orange-600 text-white'
                        : 'hover:bg-gray-800 text-gray-300'
                    }`}
                  >
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">{option.label}</span>
                    {dateRange === option.value && option.value !== 'all' && (
                      <span className="ml-auto text-xs opacity-75">(active)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* One Per Episode Toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Results</label>
              <button
                onClick={() => onOnePerEpisodeChange(!onePerEpisode)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                  onePerEpisode
                    ? 'bg-orange-600 text-white'
                    : 'hover:bg-gray-800 text-gray-300'
                }`}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                  onePerEpisode ? 'border-white bg-white' : 'border-gray-400'
                }`}>
                  {onePerEpisode && (
                    <div className="w-2 h-2 bg-orange-600 rounded-sm" />
                  )}
                </div>
                <span className="text-sm">One result per episode</span>
                {onePerEpisode && (
                  <span className="ml-auto text-xs opacity-75">(active)</span>
                )}
              </button>
            </div>

            {/* Reset Button */}
            {activeCount > 0 && (
              <div className="pt-4 border-t border-gray-700">
                <button
                  onClick={() => {
                    onSortChange('relevance');
                    onDateRangeChange('all');
                    onOnePerEpisodeChange(false);
                  }}
                  className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                >
                  Reset all filters
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}