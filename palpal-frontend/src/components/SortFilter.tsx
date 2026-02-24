"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';
import { SortOption } from './SearchFilters';

export type SortDirection = 'asc' | 'desc';

interface SortFilterProps {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  sortDirection?: SortDirection;
  onSortDirectionChange?: (direction: SortDirection) => void;
  className?: string;
}

export default function SortFilter({
  sortBy,
  onSortChange,
  sortDirection = 'desc',
  onSortDirectionChange,
  className = ''
}: SortFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const sortOptions = [
    { value: 'relevance' as SortOption, label: 'Relevance' },
    { value: 'date' as SortOption, label: 'Date' },
    { value: 'duration' as SortOption, label: 'Duration' }
  ];

  const currentSort = sortOptions.find(opt => opt.value === sortBy);

  const toggleSortDirection = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSortDirectionChange) {
      onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
    }
  };

  const getSortDirectionIcon = () => {
    return sortDirection === 'asc' ? ArrowUp : ArrowDown;
  };

  const DirectionIcon = getSortDirectionIcon();

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div className="flex">
        {/* Direction Toggle Button - Always visible on left */}
        <button
          onClick={toggleSortDirection}
          className="flex items-center justify-center px-2 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-l-lg text-white transition-all duration-200 w-8 h-10"
          title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        >
          <DirectionIcon className="w-3 h-3" />
        </button>

        {/* Main Sort Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/15 border border-l-0 border-white/20 rounded-r-lg text-white transition-all duration-200 w-32 h-10"
        >
          {/* Text Section - Left aligned */}
          <span className="text-sm font-medium truncate flex-1 text-left min-w-0">{currentSort?.label}</span>

          {/* Chevron - Right aligned */}
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full mt-1 right-0 w-40 rounded-lg shadow-xl z-[99999]" style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
          backdropFilter: 'blur(16px)',
          border: '2px solid rgba(255, 255, 255, 0.1)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 4px 24px rgba(0, 0, 0, 0.3)'
        }}>
          <div className="p-2">
            {sortOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onSortChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center px-3 py-2 rounded-md transition-colors ${
                  sortBy === option.value
                    ? 'bg-orange-600 text-white'
                    : 'hover:bg-white/10 text-gray-300'
                }`}
              >
                <span className="text-sm">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}