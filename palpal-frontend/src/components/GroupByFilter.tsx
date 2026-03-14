"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Layers, Grid, Minus } from 'lucide-react';

export type GroupByOption = 'none' | 'episode' | 'podcast';

interface GroupByFilterProps {
  groupBy: GroupByOption;
  onGroupByChange: (groupBy: GroupByOption) => void;
  className?: string;
}

export default function GroupByFilter({
  groupBy,
  onGroupByChange,
  className = ''
}: GroupByFilterProps) {
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

  const groupByOptions = [
    { value: 'none' as GroupByOption, label: 'No grouping', icon: Minus },
    { value: 'episode' as GroupByOption, label: 'By episode', icon: Layers },
    { value: 'podcast' as GroupByOption, label: 'By podcast', icon: Grid }
  ];

  const currentGroupBy = groupByOptions.find(opt => opt.value === groupBy);
  const CurrentIcon = currentGroupBy?.icon || Layers;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`filter-trigger flex items-center gap-2 px-3 py-2 rounded-lg w-40 h-10 ${groupBy !== 'none' ? 'is-active' : ''}`}
      >
        {/* Icon Section - Left aligned, fixed width */}
        <div className="flex items-center justify-start w-4 h-4 flex-shrink-0">
          <CurrentIcon className="w-4 h-4" />
        </div>

        {/* Text Section - Left aligned against icon */}
        <span className="text-sm font-medium truncate flex-1 text-left min-w-0">{currentGroupBy?.label}</span>

        {/* Chevron - Right aligned */}
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="filter-dropdown absolute top-full mt-1 right-0 w-44 rounded-lg z-[99999]">
          <div className="p-1.5">
            {groupByOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onGroupByChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                  groupBy === option.value ? 'filter-option-selected' : 'filter-option'
                }`}
              >
                <option.icon className="w-4 h-4" />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}