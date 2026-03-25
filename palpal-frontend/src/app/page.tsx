'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import SearchResults from '@/components/SearchResults';
import SearchBar from '@/components/SearchBar';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { DateRange } from '@/components/SearchFilters';
import { GroupByOption } from '@/components/GroupByFilter';
import { SearchHit, ErrorState } from '@/types';
import { loadUserPreferences, saveUserPreferences } from '@/lib/cookies';
import { PodcastConfig } from '@/types/podcast';

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
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [correctedQuery, setCorrectedQuery] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<ErrorState | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [selectedPodcasts, setSelectedPodcasts] = useState<string[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  // Filter states
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');

  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  const [podcasts, setPodcasts] = useState<PodcastConfig[]>([]);
  const [friendlyPlaceholders, setFriendlyPlaceholders] = useState<string[]>(["search..."]);

  useEffect(() => {
    fetch('/api/podcasts')
      .then(r => r.json())
      .then(setPodcasts)
      .catch(err => console.error('Failed to load podcasts:', err));
    fetch('/api/search-placeholders')
      .then(r => r.json())
      .then((data: string[]) => { if (data.length) setFriendlyPlaceholders(data); })
      .catch(() => {});
  }, []);
  const enabledPodcastIds = useMemo(
    () => podcasts.filter(p => p.enabled).map(p => p.id).sort(),
    [podcasts]
  );
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Function to update URL with current search state
  const updateURL = useCallback((params: {
    query?: string;
    podcasts?: string[];
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

    // Update podcasts parameter — omit from URL when all enabled podcasts are selected (default)
    if (params.podcasts !== undefined) {
      const sorted = [...params.podcasts].sort();
      const isDefault = sorted.length === enabledPodcastIds.length &&
        sorted.every((id, i) => id === enabledPodcastIds[i]);
      if (params.podcasts.length > 0 && !isDefault) {
        url.searchParams.set('podcasts', params.podcasts.join(','));
      } else {
        url.searchParams.delete('podcasts');
      }
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

    // Update URL without triggering a Next.js re-render
    const newURL = url.pathname + (url.search ? url.search : '');
    window.history.replaceState(null, '', newURL);
  }, [enabledPodcastIds]);

  // Rotate placeholder text every 5.5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % friendlyPlaceholders.length);
    }, 5500);
    return () => clearInterval(interval);
  }, [friendlyPlaceholders.length]);

  // Mobile search focus handlers
  const handleSearchFocus = (inputElement: HTMLInputElement) => {
    setIsSearchFocused(true);

    // On mobile, scroll the search bar to near the top of the viewport
    if (window.innerWidth < 768) {
      setTimeout(() => {
        const rect = inputElement.getBoundingClientRect();
        const offsetTop = window.scrollY + rect.top;
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
    if (podcasts.length === 0) return;

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

    if (urlDateRange && ['all', 'last_week', 'last_month', 'last_3_months', 'last_year', 'custom'].includes(urlDateRange)) {
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

  // Sync all filter state to the URL in one effect to avoid multiple history entries
  useEffect(() => {
    if (preferencesLoaded) {
      updateURL({ query: searchQuery, podcasts: selectedPodcasts, dateRange, groupBy });
    }
  }, [searchQuery, selectedPodcasts, dateRange, groupBy, preferencesLoaded, updateURL]);

  // Reusable search function
  const performSearch = useCallback(async (query: string, pageNum: number = 1, append: boolean = false) => {
    if (!query) {
      setSearchResults([]);
      setTotalHits(0);
      setCurrentPage(1);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
    }
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
        dateRange: dateRange,
        page: String(pageNum),
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
      if (append) {
        setSearchResults(prev => [...prev, ...results.hits as SearchHit[]]);
      } else {
        setSearchResults(results.hits as SearchHit[]);
        setCurrentPage(1);
        setCorrectedQuery(results.correctedQuery ?? null);
      }
      setTotalHits(results.estimatedTotalHits || 0);
    } catch (err) {
      const errorState = getErrorState(err);
      setSearchError(errorState);
      console.error('Search error:', err);
      setSearchResults([]);
      setTotalHits(0);
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  }, [selectedPodcasts, podcasts, dateRange, customStartDate, customEndDate]);

  // Search only on explicit submit (Enter key or form submit)
  const handleImmediateSearch = (query: string) => {
    setHasSearched(true);
    setCurrentPage(1);
    performSearch(query, 1, false);
  };

  const handleLoadMore = useCallback(() => {
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    performSearch(searchQuery, nextPage, true);
  }, [currentPage, searchQuery, performSearch]);

  // Handle logo click to reset everything
  const handleLogoReset = () => {
    // Reset search query
    setSearchQuery('');
    setHasSearched(false);

    // Reset filters to defaults
    setDateRange('all');
    setGroupBy('none');

    // Reset selected podcasts to all enabled podcasts
    const enabledPodcastIds = podcasts.filter(p => p.enabled).map(p => p.id);
    setSelectedPodcasts(enabledPodcastIds);

    // Clear search results
    setSearchResults([]);
    setTotalHits(0);
    setCurrentPage(1);
    setSearchError(null);
    setCorrectedQuery(null);
    setIsSearching(false);
    setIsLoadingMore(false);

    // Clear URL parameters
    router.replace('/', { scroll: false });
  };

  return (
    <div className="page-container">
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
                className="h-20 sm:h-24 md:h-28 drop-shadow-2xl"
                style={{ width: 'auto', height: 'auto' }}
              />
            </div>
          </div>
          {!searchQuery && (
            <p className="text-lg text-body max-w-xl mx-auto font-medium leading-relaxed mb-8">
              Search every word of your favorite podcasts
            </p>
          )}
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
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onCustomDateChange={(startDate, endDate) => {
              setCustomStartDate(startDate);
              setCustomEndDate(endDate);
            }}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />

          <div className={`transition-opacity duration-200 ${!searchQuery ? 'hidden' : ''}`}>
            <SearchResults
              key="search-results"
              query={searchQuery || ''}
              correctedQuery={correctedQuery}
              results={searchResults}
              totalHits={totalHits}
              error={searchError}
              isSearching={isSearching}
              hasSearched={hasSearched}
              isLoadingMore={isLoadingMore}
              hasMore={searchResults.length < totalHits && totalHits > 0}
              onLoadMore={handleLoadMore}
              groupBy={groupBy}
              podcasts={podcasts}
            />
          </div>

          {/* Mobile: Spacer to ensure scrollable content when search is focused */}
          {isSearchFocused && (
            <div className="md:hidden" style={{ height: '100vh' }}></div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
