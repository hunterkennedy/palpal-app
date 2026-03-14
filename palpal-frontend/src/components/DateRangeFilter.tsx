"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Calendar } from 'lucide-react';
import { DateRange } from './SearchFilters';

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onCustomDateChange?: (startDate: string, endDate: string) => void;
  customStartDate?: string;
  customEndDate?: string;
  className?: string;
}

export default function DateRangeFilter({
  dateRange,
  onDateRangeChange,
  onCustomDateChange,
  customStartDate = '',
  customEndDate = '',
  className = ''
}: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomInputs, setShowCustomInputs] = useState(dateRange === 'custom');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync showCustomInputs with dateRange prop
  useEffect(() => {
    setShowCustomInputs(dateRange === 'custom');
  }, [dateRange]);

  const dateOptions = [
    { value: 'all' as DateRange, label: 'All time' },
    { value: 'last_week' as DateRange, label: 'Last week' },
    { value: 'last_month' as DateRange, label: 'Last month' },
    { value: 'last_3_months' as DateRange, label: 'Last 3 months' },
    { value: 'last_year' as DateRange, label: 'Last year' },
    { value: 'custom' as DateRange, label: 'Custom' }
  ];

  const currentRange = dateOptions.find(opt => opt.value === dateRange);

  const handleCustomRangeClick = () => {
    if (dateRange === 'custom' && showCustomInputs) {
      setShowCustomInputs(false);
      setIsOpen(false);
    } else {
      onDateRangeChange('custom');
      setShowCustomInputs(true);
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`filter-trigger flex items-center gap-2 px-3 py-2 rounded-lg w-40 h-10 ${dateRange !== 'all' ? 'is-active' : ''}`}
      >
        {/* Icon Section - Left aligned, fixed width */}
        <div className="flex items-center justify-start w-4 h-4 flex-shrink-0">
          <Calendar className="w-4 h-4" />
        </div>

        {/* Text Section - Left aligned against icon */}
        <span className="text-sm font-medium truncate flex-1 text-left min-w-0">{currentRange?.label}</span>

        {/* Chevron - Right aligned */}
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="filter-dropdown absolute top-full mt-1 right-0 w-44 rounded-lg z-[99999]">
          <div className="p-1.5">
            {dateOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  if (option.value === 'custom') {
                    handleCustomRangeClick();
                  } else {
                    onDateRangeChange(option.value);
                    setIsOpen(false);
                    setShowCustomInputs(false);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                  dateRange === option.value ? 'filter-option-selected' : 'filter-option'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>{option.label}</span>
              </button>
            ))}

            {/* Custom Date Range Inputs */}
            {showCustomInputs && (
              <div className="mt-2 pt-2 space-y-2" style={{ borderTop: '1px solid var(--border-primary)' }}>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Start Date</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => onCustomDateChange?.(e.target.value, customEndDate)}
                    className="w-full px-3 py-2 rounded-md text-sm focus:outline-none transition-colors"
                    style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>End Date</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => onCustomDateChange?.(customStartDate, e.target.value)}
                    className="w-full px-3 py-2 rounded-md text-sm focus:outline-none transition-colors"
                    style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}