'use client';

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Check, RotateCcw } from 'lucide-react';
import { SortOption, DateRange } from './SearchFilters';
import { SortDirection } from './SortFilter';
import { GroupByOption } from './GroupByFilter';
import { PodcastConfig } from '@/types/podcast';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Current filter values
  podcasts: PodcastConfig[];
  selectedPodcasts: string[];
  sortBy: SortOption;
  sortDirection: SortDirection;
  dateRange: DateRange;
  groupBy: GroupByOption;
  customStartDate?: string;
  customEndDate?: string;
  // Change handlers
  onApplyFilters: (filters: {
    selectedPodcasts: string[];
    sortBy: SortOption;
    sortDirection: SortDirection;
    dateRange: DateRange;
    groupBy: GroupByOption;
    customStartDate: string;
    customEndDate: string;
  }) => void;
  onCustomDateChange?: (startDate: string, endDate: string) => void;
}

export default function FilterModal({
  isOpen,
  onClose,
  podcasts,
  selectedPodcasts,
  sortBy,
  sortDirection,
  dateRange,
  groupBy,
  customStartDate = '',
  customEndDate = '',
  onApplyFilters,
  onCustomDateChange
}: FilterModalProps) {
  // Local state for the modal (allows cancel functionality)
  const [localSelectedPodcasts, setLocalSelectedPodcasts] = useState<string[]>(selectedPodcasts);
  const [localSortBy, setLocalSortBy] = useState<SortOption>(sortBy);
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>(sortDirection);
  const [localDateRange, setLocalDateRange] = useState<DateRange>(dateRange);
  const [localGroupBy, setLocalGroupBy] = useState<GroupByOption>(groupBy);

  // Custom date range state
  const [showCustomDateInputs, setShowCustomDateInputs] = useState(false);

  // Update local state when props change
  useEffect(() => {
    setLocalSelectedPodcasts(selectedPodcasts);
    setLocalSortBy(sortBy);
    setLocalSortDirection(sortDirection);
    setLocalDateRange(dateRange);
    setLocalGroupBy(groupBy);

    // Show custom inputs if date range is custom
    if (dateRange === 'custom') {
      setShowCustomDateInputs(true);
    } else {
      setShowCustomDateInputs(false);
    }
  }, [selectedPodcasts, sortBy, sortDirection, dateRange, groupBy, customStartDate, customEndDate]);

  const handleApply = () => {
    onApplyFilters({
      selectedPodcasts: localSelectedPodcasts,
      sortBy: localSortBy,
      sortDirection: localSortDirection,
      dateRange: localDateRange,
      groupBy: localGroupBy,
      customStartDate: customStartDate,
      customEndDate: customEndDate
    });
    onClose();
  };

  const handleReset = () => {
    const enabledPodcastIds = podcasts.filter(p => p.enabled).map(p => p.id);
    setLocalSelectedPodcasts(enabledPodcastIds);
    setLocalSortBy('date');
    setLocalSortDirection('desc');
    setLocalDateRange('all');
    setLocalGroupBy('none');
    setShowCustomDateInputs(false);
  };

  const togglePodcast = (podcastId: string) => {
    setLocalSelectedPodcasts(prev =>
      prev.includes(podcastId)
        ? prev.filter(id => id !== podcastId)
        : [...prev, podcastId]
    );
  };

  const selectAllPodcasts = () => {
    const enabledPodcastIds = podcasts.filter(p => p.enabled).map(p => p.id);
    setLocalSelectedPodcasts(enabledPodcastIds);
  };

  const handleDateRangeChange = (range: DateRange) => {
    setLocalDateRange(range);
    if (range === 'custom') {
      setShowCustomDateInputs(true);
    } else {
      setShowCustomDateInputs(false);
    }
  };



  if (!isOpen) return null;

  const enabledPodcasts = podcasts.filter(p => p.enabled);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0, 0, 0, 0.6)' }}
        onClick={onClose}
      />

      {/* Modal - positioned at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 w-full max-h-[85vh] rounded-t-2xl flex flex-col"
        style={{
          background: 'var(--surface-elevated)',
          borderColor: 'rgba(255, 140, 66, 0.3)',
          borderWidth: '1px 1px 0 1px',
          borderStyle: 'solid',
          transform: 'translateY(0)',
          animation: 'slideUp 0.3s ease-out'
        }}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Filters</h2>
          <button
            onClick={onClose}
            className="modal-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="modal-content-scroll">
          <div className="modal-body">
            {/* Podcasts Section */}
            <div className="modal-item">
              <div className="flex items-center justify-between mb-3">
                <h3 className="modal-item-title">Podcasts</h3>
                <button
                  onClick={selectAllPodcasts}
                  className="text-sm nav-link-accent"
                >
                  Select All
                </button>
              </div>
              <div className="space-y-2">
                {enabledPodcasts.map(podcast => (
                  <label
                    key={podcast.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={localSelectedPodcasts.includes(podcast.id)}
                      onChange={() => togglePodcast(podcast.id)}
                      className="w-4 h-4 text-orange-500 rounded border-gray-600 bg-gray-700 focus:ring-orange-500"
                    />
                    <span className="text-body text-sm">{podcast.displayName}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Sort Section */}
            <div className="modal-item">
              <h3 className="modal-item-title mb-3">Sort By</h3>
              <div className="space-y-2">
                {[
                  { value: 'date' as SortOption, label: 'Date' },
                  { value: 'duration' as SortOption, label: 'Duration' }
                ].map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name="sort"
                      checked={localSortBy === option.value}
                      onChange={() => setLocalSortBy(option.value)}
                      className="w-4 h-4 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-body text-sm">{option.label}</span>
                  </label>
                ))}
              </div>

              {/* Sort Direction */}
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>Direction</h4>
                {[
                  { value: 'desc' as SortDirection, label: 'Descending' },
                  { value: 'asc' as SortDirection, label: 'Ascending' }
                ].map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name="sortDirection"
                      checked={localSortDirection === option.value}
                      onChange={() => setLocalSortDirection(option.value)}
                      className="w-4 h-4 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-body text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Date Range Section */}
            <div className="modal-item">
              <h3 className="modal-item-title mb-3">Date Range</h3>
              <div className="space-y-2">
                {[
                  { value: 'all' as DateRange, label: 'All Time' },
                  { value: 'last_week' as DateRange, label: 'Last Week' },
                  { value: 'last_month' as DateRange, label: 'Last Month' },
                  { value: 'last_3_months' as DateRange, label: 'Last 3 Months' },
                  { value: 'last_year' as DateRange, label: 'Last Year' },
                  { value: 'custom' as DateRange, label: 'Custom Range' }
                ].map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name="dateRange"
                      checked={localDateRange === option.value}
                      onChange={() => handleDateRangeChange(option.value)}
                      className="w-4 h-4 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-body text-sm">{option.label}</span>
                  </label>
                ))}
              </div>

              {/* Custom Date Inputs */}
              {(showCustomDateInputs || localDateRange === 'custom') && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Start Date</label>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => onCustomDateChange?.(e.target.value, customEndDate)}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500"
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderColor: 'rgba(255, 255, 255, 0.2)',
                          color: 'var(--text-secondary)'
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>End Date</label>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => onCustomDateChange?.(customStartDate, e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500"
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderColor: 'rgba(255, 255, 255, 0.2)',
                          color: 'var(--text-secondary)'
                        }}
                      />
                    </div>

                  </div>
                </div>
              )}
            </div>

            {/* Group By Section */}
            <div className="modal-item">
              <h3 className="modal-item-title mb-3">Group By</h3>
              <div className="space-y-2">
                {[
                  { value: 'none' as GroupByOption, label: 'None' },
                  { value: 'podcast' as GroupByOption, label: 'Podcast' },
                  { value: 'episode' as GroupByOption, label: 'Episode' }
                ].map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name="groupBy"
                      checked={localGroupBy === option.value}
                      onChange={() => setLocalGroupBy(option.value)}
                      className="w-4 h-4 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-body text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="flex gap-3">
            <button
              onClick={handleReset}
              className="btn-secondary flex items-center gap-2 px-4 py-3"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={handleApply}
              className="btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-3"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <Check className="w-4 h-4" />
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}