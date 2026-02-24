"use client";

import React from 'react';

interface LoadingSkeletonProps {
  className?: string;
  variant?: 'card' | 'text' | 'circle' | 'button';
  width?: string;
  height?: string;
  count?: number;
}

export default function LoadingSkeleton({
  className = '',
  variant = 'text',
  width,
  height,
  count = 1
}: LoadingSkeletonProps) {
  const baseClasses = "animate-pulse bg-gradient-to-r from-gray-300 via-gray-200 to-gray-300 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700";

  const getVariantClasses = () => {
    switch (variant) {
      case 'card':
        return 'rounded-2xl h-48 w-full';
      case 'circle':
        return 'rounded-full w-10 h-10';
      case 'button':
        return 'rounded-full h-10 w-24';
      case 'text':
      default:
        return 'rounded h-4 w-full';
    }
  };

  const style = {
    ...(width && { width }),
    ...(height && { height })
  };

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={`${baseClasses} ${getVariantClasses()} ${className}`}
          style={style}
        />
      ))}
    </>
  );
}

export function PodcastCardSkeleton() {
  return (
    <div className="w-48 flex-shrink-0 animate-fadeInUp">
      <div className="relative rounded-2xl aspect-[4/3] overflow-hidden border-3 border-gray-200 dark:border-gray-700">
        <LoadingSkeleton variant="card" className="absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center">
          <LoadingSkeleton variant="circle" className="mb-4" />
        </div>
      </div>
    </div>
  );
}

export function SearchResultsSkeleton() {
  return (
    <div className="space-y-4 animate-fadeIn">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="card-primary p-6">
          <div className="flex gap-4">
            <LoadingSkeleton variant="circle" width="60px" height="60px" />
            <div className="flex-1 space-y-3">
              <LoadingSkeleton width="60%" />
              <LoadingSkeleton width="40%" />
              <LoadingSkeleton width="80%" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}