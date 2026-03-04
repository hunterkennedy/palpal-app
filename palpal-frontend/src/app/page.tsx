'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import SearchResults from '@/components/SearchResults';
import SearchBar from '@/components/SearchBar';
import Navbar from '@/components/Navbar';
import WhatsNewBubble from '@/components/WhatsNewBubble';
import { SortOption, DateRange } from '@/components/SearchFilters';
import { SortDirection } from '@/components/SortFilter';
import { GroupByOption } from '@/components/GroupByFilter';
import { useDebounce } from '@/hooks/useDebounce';
import { SearchHit, ErrorState } from '@/types';
import { loadUserPreferences, saveUserPreferences } from '@/lib/cookies';
import { getAllStaticPodcastConfigs } from '@/lib/static-podcasts';

// SearchHit interface moved to @/types

const getErrorState = (error: unknown): ErrorState => {
  const errorWithResponse = error as { response?: { status?: number } };
  if (errorWithResponse?.response?.status === 429) {
    return {
      type: 'rate_limit',
      title: 'Too Many Requests',
      message: 'Please wait a moment before searching again.',
      action: {
        label: 'Try Again',
        handler: () => window.location.reload()
      }
    };
  }
  
  if (errorWithResponse?.response?.status && errorWithResponse.response.status >= 500) {
    return {
      type: 'server_error',
      title: 'Service Temporarily Unavailable',
      message: 'Our search service is having issues. Please try again in a few minutes.',
      action: {
        label: 'Retry',
        handler: () => window.location.reload()
      }
    };
  }
  
  if (errorWithResponse?.response?.status === 400) {
    return {
      type: 'invalid_input',
      title: 'Invalid Search',
      message: 'Please check your search terms and try again.',
    };
  }
  
  return {
    type: 'connection',
    title: 'Database Connection Problem',
    message: 'Try again in a few moments',
    action: {
      label: 'Retry',
      handler: () => window.location.reload()
    }
  };
};

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [searchError, setSearchError] = useState<ErrorState | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [selectedPodcasts, setSelectedPodcasts] = useState<string[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  // Track immediate search to prevent duplicate debounced search
  const lastImmediateSearchRef = useRef<{ query: string; timestamp: number } | null>(null);

  // Filter states
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');

  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Load podcasts statically at build time
  const podcasts = getAllStaticPodcastConfigs();
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Function to update URL with current search state
  const updateURL = useCallback((params: {
    query?: string;
    podcasts?: string[];
    sort?: SortOption;
    sortDirection?: SortDirection;
    dateRange?: DateRange;
    groupBy?: GroupByOption;
  }) => {
    const url = new URL(window.location.href);

    // Update query parameter
    if (params.query !== undefined) {
      if (params.query.trim()) {
        url.searchParams.set('q', params.query.trim());
      } else {
        url.searchParams.delete('q');
      }
    }

    // Update podcasts parameter
    if (params.podcasts !== undefined) {
      if (params.podcasts.length > 0 && JSON.stringify(params.podcasts) !== JSON.stringify(['pal'])) {
        url.searchParams.set('podcasts', params.podcasts.join(','));
      } else {
        url.searchParams.delete('podcasts');
      }
    }

    // Update sort parameters
    if (params.sort !== undefined && params.sort !== 'relevance') {
      url.searchParams.set('sort', params.sort);
    } else if (params.sort !== undefined) {
      url.searchParams.delete('sort');
    }

    if (params.sortDirection !== undefined && params.sortDirection !== 'desc') {
      url.searchParams.set('sortDirection', params.sortDirection);
    } else if (params.sortDirection !== undefined) {
      url.searchParams.delete('sortDirection');
    }

    // Update date range parameter
    if (params.dateRange !== undefined && params.dateRange !== 'all') {
      url.searchParams.set('dateRange', params.dateRange);
    } else if (params.dateRange !== undefined) {
      url.searchParams.delete('dateRange');
    }

    // Update group by parameter
    if (params.groupBy !== undefined && params.groupBy !== 'none') {
      url.searchParams.set('groupBy', params.groupBy);
    } else if (params.groupBy !== undefined) {
      url.searchParams.delete('groupBy');
    }

    // Update URL without triggering a page reload
    const newURL = url.pathname + (url.search ? url.search : '');
    router.replace(newURL, { scroll: false });
  }, [router]);

  const friendlyPlaceholders = [
    "there's multiple...",
    "gothic lolitas...",
    "it goes kuru...",
    "the very limit of a molecule...",
    "even a peppermint...",
    "pizza..."
  ];

  // Rotate placeholder text every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % friendlyPlaceholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [friendlyPlaceholders.length]);

  // Mobile search focus handlers
  const handleSearchFocus = (inputElement: HTMLInputElement) => {
    setIsSearchFocused(true);

    // On mobile, scroll the search bar to near the top of the viewport
    if (window.innerWidth < 768) {
      setTimeout(() => {
        const rect = inputElement.getBoundingClientRect();
        const offsetTop = window.pageYOffset + rect.top;
        // Scroll so search bar is about 80px from top (leaving some space)
        window.scrollTo({
          top: offsetTop - 80,
          behavior: 'smooth'
        });
      }, 100); // Small delay to ensure focus is complete
    }
  };

  const handleSearchBlur = () => {
    // Delay to allow for submit to process first
    setTimeout(() => {
      setIsSearchFocused(false);
    }, 150);
  };

  const getSearchPlaceholder = () => {
    if (selectedPodcasts.length === 0 || selectedPodcasts.length === podcasts.length) {
      return friendlyPlaceholders[placeholderIndex];
    } else if (selectedPodcasts.length === 1) {
      const podcast = podcasts.find(p => p.id === selectedPodcasts[0]);
      return `Search ${podcast?.displayName}...`;
    } else {
      return `Search ${selectedPodcasts.length} selected podcasts...`;
    }
  };


  // Load user preferences from cookies and URL parameters on mount
  useEffect(() => {
    const savedPreferences = loadUserPreferences();

    // Set default to all enabled podcasts
    const enabledPodcastIds = podcasts.filter(p => p.enabled).map(p => p.id);
    let initialPodcasts = enabledPodcastIds;

    if (savedPreferences) {
      if (savedPreferences.selectedPodcasts) {
        initialPodcasts = savedPreferences.selectedPodcasts;
      }
    }

    setSelectedPodcasts(initialPodcasts);

    // Restore state from URL parameters (URL takes precedence over cookies)
    const urlQuery = searchParams?.get('q');
    const urlPodcasts = searchParams?.get('podcasts');
    const urlSort = searchParams?.get('sort') as SortOption;
    const urlSortDirection = searchParams?.get('sortDirection') as SortDirection;
    const urlDateRange = searchParams?.get('dateRange') as DateRange;
    const urlGroupBy = searchParams?.get('groupBy') as GroupByOption;

    if (urlQuery) {
      setSearchQuery(urlQuery);
    }

    if (urlPodcasts) {
      const podcastList = urlPodcasts.split(',').filter(Boolean);
      // Validate that the podcasts exist
      const validPodcasts = podcastList.filter(id => podcasts.some(p => p.id === id));
      if (validPodcasts.length > 0) {
        setSelectedPodcasts(validPodcasts);
      }
    }

    if (urlSort && ['relevance', 'date', 'title'].includes(urlSort)) {
      setSortBy(urlSort);
    }

    if (urlSortDirection && ['asc', 'desc'].includes(urlSortDirection)) {
      setSortDirection(urlSortDirection);
    }

    if (urlDateRange && ['all', 'day', 'week', 'month', 'year', 'custom'].includes(urlDateRange)) {
      setDateRange(urlDateRange);
    }

    if (urlGroupBy && ['none', 'podcast', 'episode'].includes(urlGroupBy)) {
      setGroupBy(urlGroupBy);
    }

    setPreferencesLoaded(true);
  }, [searchParams, podcasts]);


  // Save preferences to cookies when they change (but only after initial load)
  useEffect(() => {
    if (preferencesLoaded) {
      saveUserPreferences({ selectedPodcasts });
    }
  }, [selectedPodcasts, preferencesLoaded]);

  // Update URL when search query changes
  useEffect(() => {
    if (preferencesLoaded) {
      updateURL({ query: searchQuery });
    }
  }, [searchQuery, preferencesLoaded, updateURL]);

  // Update URL when selected podcasts change
  useEffect(() => {
    if (preferencesLoaded) {
      updateURL({ podcasts: selectedPodcasts });
    }
  }, [selectedPodcasts, preferencesLoaded, updateURL]);

  // Update URL when sort options change
  useEffect(() => {
    if (preferencesLoaded) {
      updateURL({ sort: sortBy, sortDirection });
    }
  }, [sortBy, sortDirection, preferencesLoaded, updateURL]);

  // Update URL when date range changes
  useEffect(() => {
    if (preferencesLoaded) {
      updateURL({ dateRange });
    }
  }, [dateRange, preferencesLoaded, updateURL]);

  // Update URL when group by option changes
  useEffect(() => {
    if (preferencesLoaded) {
      updateURL({ groupBy });
    }
  }, [groupBy, preferencesLoaded, updateURL]);

  // Reusable search function
  const performSearch = useCallback(async (query: string) => {
    if (!query) {
      setSearchResults([]);
      setTotalHits(0);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      // If exactly one podcast is selected, pass it as podcast_id; otherwise search all
      const enabledPodcastIds = podcasts.filter(p => p.enabled).map(p => p.id);
      const enabledSelected = selectedPodcasts.filter(id => enabledPodcastIds.includes(id));
      const podcast_id = enabledSelected.length === 1 ? enabledSelected[0] : undefined;

      // Build query parameters for sorting and filtering
      const searchParams = new URLSearchParams({
        q: query,
        limit: '20',
        sort: sortBy,
        dateRange: dateRange
      });

      if (podcast_id) searchParams.set('podcast_id', podcast_id);

      // Add custom date parameters if date range is custom
      if (dateRange === 'custom' && customStartDate && customEndDate) {
        searchParams.set('startDate', customStartDate);
        searchParams.set('endDate', customEndDate);
      }

      const response = await fetch(`/api/search?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error('Search request failed');
      }
      const results = await response.json();
      setSearchResults(results.hits as SearchHit[]);
      setTotalHits(results.estimatedTotalHits || 0);
    } catch (err) {
      const errorState = getErrorState(err);
      setSearchError(errorState);
      console.error('Search error:', err);
      setSearchResults([]);
      setTotalHits(0);
    } finally {
      setIsSearching(false);
    }
  }, [selectedPodcasts, podcasts, sortBy, sortDirection, dateRange, customStartDate, customEndDate]);

  // Handle immediate search (e.g., on Enter key)
  const handleImmediateSearch = (query: string) => {
    // Record this immediate search to prevent duplicate debounced search
    lastImmediateSearchRef.current = {
      query: query.trim(),
      timestamp: Date.now()
    };
    performSearch(query);
  };

  // Handle search when debounced query changes
  useEffect(() => {
    // Check if we just performed an immediate search for the same query
    const lastImmediate = lastImmediateSearchRef.current;
    const currentQuery = debouncedSearchQuery.trim();

    // Skip debounced search if:
    // 1. We just did an immediate search for the same query
    // 2. The immediate search was within the last 500ms (debounce timeout + buffer)
    if (lastImmediate &&
        lastImmediate.query === currentQuery &&
        Date.now() - lastImmediate.timestamp < 500) {
      return;
    }

    performSearch(debouncedSearchQuery);
  }, [debouncedSearchQuery, performSearch]);

  // Handle logo click to reset everything
  const handleLogoReset = () => {
    // Reset search query
    setSearchQuery('');

    // Reset filters to defaults
    setSortBy('relevance');
    setSortDirection('desc');
    setDateRange('all');
    setGroupBy('none');

    // Reset selected podcasts to all enabled podcasts
    const enabledPodcastIds = podcasts.filter(p => p.enabled).map(p => p.id);
    setSelectedPodcasts(enabledPodcastIds);

    // Clear search results
    setSearchResults([]);
    setTotalHits(0);
    setSearchError(null);
    setIsSearching(false);

    // Clear URL parameters
    router.replace('/', { scroll: false });
  };

  return (
    <div className="page-container">
      {/* What's New Bubble */}
      <WhatsNewBubble />

      {/* Navigation Header */}
      <Navbar currentPage="search" />

      {/* Main Content */}
      <div className="content-container">
        <header className="text-center mb-8">
          <div className="mb-6 flex justify-center">
            <div className="relative group cursor-pointer" onClick={handleLogoReset}>
              <Image
                src="/title.png"
                alt="palpal"
                width={160}
                height={160}
                priority
                className="h-20 sm:h-24 md:h-28 drop-shadow-2xl animate-gentleFloat transition-transform duration-300 group-hover:scale-105"
                style={{ width: 'auto', height: 'auto' }}
              />
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-orange-400/20 to-yellow-400/10 blur-xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:animate-pulseGlow"></div>
            </div>
          </div>
          <p className="text-lg text-body max-w-xl mx-auto font-medium leading-relaxed mb-8">
            The most intelligent search engine for your favorite podcasts
          </p>
        </header>

        <div className="max-w-4xl mx-auto">
          {/* Search Bar with integrated filters and podcast selector */}
          <SearchBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchFocus={handleSearchFocus}
            onSearchBlur={handleSearchBlur}
            onSearch={handleImmediateSearch}
            placeholder={getSearchPlaceholder()}
            className="mb-6"
            podcasts={podcasts}
            selectedPodcasts={selectedPodcasts}
            onPodcastSelectionChange={setSelectedPodcasts}
            sortBy={sortBy}
            onSortChange={setSortBy}
            sortDirection={sortDirection}
            onSortDirectionChange={setSortDirection}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onCustomDateChange={(startDate, endDate) => {
              console.log('Custom date change received:', startDate, endDate);
              setCustomStartDate(startDate);
              setCustomEndDate(endDate);
            }}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />

          <div className={`transition-opacity duration-200 ${!debouncedSearchQuery ? 'hidden' : ''}`}>
            <SearchResults
              key="search-results"
              query={debouncedSearchQuery || ''}
              results={searchResults}
              totalHits={totalHits}
              error={searchError}
              isSearching={isSearching}
              groupBy={groupBy}
            />
          </div>

          {/* Mobile: Spacer to ensure scrollable content when search is focused */}
          {isSearchFocused && (
            <div className="md:hidden" style={{ height: '100vh' }}></div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="footer-container">
        <div className="footer-content">
          <div className="flex flex-col items-center space-y-6 text-center">
            <div>
              <p className="text-meta text-lg">
                Made by{' '}
                <Link
                  href="/about"
                  className="nav-link-accent hover:text-orange-300 transition-colors duration-200"
                >
                  Hunter Kennedy
                </Link>
              </p>
            </div>

            <div className="flex space-x-8 text-sm">
              <Link
                href="/tos"
                className="nav-link hover:text-orange-300 transition-colors duration-200"
              >
                Terms of Service
              </Link>
              <Link
                href="/pp"
                className="nav-link hover:text-orange-300 transition-colors duration-200"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
