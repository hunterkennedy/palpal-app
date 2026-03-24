'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { CheckCircle2, Circle, Play, Tv2, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, Download, Upload } from 'lucide-react';
import { getWatchedVideoIds, toggleWatched, clearWatched, exportWatched, importWatched } from '@/lib/watchlist';
import { PodcastConfig } from '@/types/podcast';
import { EpisodeInfo } from '@/lib/conductor';

type FilterOption = 'all' | 'unwatched' | 'watched';
type SiteFilter = 'all' | 'youtube' | 'patreon';
type SortColumn = 'date' | 'title' | 'duration';
type SortDir = 'asc' | 'desc';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getEpisodeUrl(episode: EpisodeInfo): string {
  if (episode.site === 'patreon') {
    return `https://www.patreon.com/posts/${episode.video_id}`;
  }
  return episode.youtube_url;
}

function isPatreon(episode: EpisodeInfo): boolean {
  return episode.site === 'patreon';
}

function SortIcon({ column, sortCol, sortDir }: { column: SortColumn; sortCol: SortColumn; sortDir: SortDir }) {
  if (sortCol !== column) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
    : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />;
}

interface WatchlistPageProps {
  initialEpisodes: EpisodeInfo[];
  initialPodcasts: PodcastConfig[];
}

export default function WatchlistPage({ initialEpisodes, initialPodcasts }: WatchlistPageProps) {
  const enabledPods = initialPodcasts.filter(p => p.enabled);
  const [episodes] = useState<EpisodeInfo[]>(() => initialEpisodes.filter(e => !e.blacklisted));
  const [podcasts] = useState<PodcastConfig[]>(enabledPods);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string | null>(
    enabledPods.length > 0 ? enabledPods[0].id : null,
  );
  const [filter, setFilter] = useState<FilterOption>('all');
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all');
  const [sortCol, setSortCol] = useState<SortColumn>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [importMsg, setImportMsg] = useState<string | null>(null);

  useEffect(() => {
    setWatched(getWatchedVideoIds());
  }, []);

  const handleToggle = useCallback((videoId: string) => {
    const nowWatched = toggleWatched(videoId);
    setWatched(prev => {
      const next = new Set(prev);
      if (nowWatched) next.add(videoId);
      else next.delete(videoId);
      return next;
    });
  }, []);

  const handleClearAll = () => {
    if (confirm('Clear all watched history? This cannot be undone.')) {
      clearWatched();
      setWatched(new Set());
    }
  };

  const handleExport = () => {
    exportWatched(episodes.map(e => ({
      video_id: e.video_id,
      title: e.title,
    })));
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const added = await importWatched(file);
      setWatched(getWatchedVideoIds());
      setImportMsg(added > 0 ? `Imported ${added} new episode${added !== 1 ? 's' : ''}.` : 'No new episodes to import.');
    } catch {
      setImportMsg('Import failed — make sure the file is a valid palpal export.');
    }
    e.target.value = '';
    setTimeout(() => setImportMsg(null), 4000);
  };

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'title' ? 'asc' : 'desc');
    }
  };

  const podcastEpisodes = episodes.filter(e => e.podcast_id === selectedPodcastId);
  const watchedCount = podcastEpisodes.filter(e => watched.has(e.video_id)).length;
  const totalWatched = episodes.filter(e => watched.has(e.video_id)).length;
  const progressPct =
    podcastEpisodes.length > 0
      ? Math.round((watchedCount / podcastEpisodes.length) * 100)
      : 0;

  const podcastSites = useMemo(
    () => new Set(podcastEpisodes.map(e => e.site)),
    [podcastEpisodes],
  );

  const filteredSortedEpisodes = useMemo(() => {
    let list = podcastEpisodes.filter(e => {
      if (filter === 'watched') return watched.has(e.video_id);
      if (filter === 'unwatched') return !watched.has(e.video_id);
      return true;
    }).filter(e => {
      if (siteFilter === 'youtube') return e.site === 'youtube';
      if (siteFilter === 'patreon') return e.site === 'patreon';
      return true;
    });

    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'date') {
        const da = a.publication_date;
        const db = b.publication_date;
        if (!da && !db) cmp = 0;
        else if (!da) return 1;
        else if (!db) return -1;
        else cmp = da < db ? -1 : da > db ? 1 : 0;
      } else if (sortCol === 'title') {
        cmp = a.title.localeCompare(b.title);
      } else if (sortCol === 'duration') {
        cmp = (a.duration_seconds ?? 0) - (b.duration_seconds ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [podcastEpisodes, filter, siteFilter, watched, sortCol, sortDir]);

  const thClass =
    'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider select-none cursor-pointer group';
  const thStyle = { color: 'var(--text-muted)', borderBottom: '1px solid var(--border-primary)' };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-12">
        <h1 className="heading-primary">Episodes</h1>
        <div className="flex items-center justify-between">
          <p className="text-xl text-body">
            {totalWatched} episode{totalWatched !== 1 ? 's' : ''} watched across all podcasts
          </p>
          <div className="flex items-center gap-2">
            {importMsg && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{importMsg}</span>
            )}
            <button
              onClick={handleExport}
              disabled={watched.size === 0}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all duration-300 pill-enhanced disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <label
              htmlFor="watchlist-import"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all duration-300 pill-enhanced cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Import
            </label>
            <input
              id="watchlist-import"
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImport}
            />
            {totalWatched > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all duration-300 text-gray-200 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
                Clear History
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="section-container">
        <>
          {/* Podcast tabs */}
            <section className="mb-6">
              <div className="flex gap-2 flex-wrap">
                {podcasts.map(pod => {
                  const podEps = episodes.filter(e => e.podcast_id === pod.id);
                  const podWatched = podEps.filter(e => watched.has(e.video_id)).length;
                  const isSelected = selectedPodcastId === pod.id;
                  return (
                    <button
                      key={pod.id}
                      onClick={() => {
                        setSelectedPodcastId(pod.id);
                        setFilter('all');
                        setSiteFilter('all');
                      }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 ${
                        isSelected ? 'pill-selected' : 'pill-enhanced'
                      }`}
                    >
                      {pod.image && (
                        <Image
                          src={pod.image}
                          alt={pod.displayName}
                          width={16}
                          height={16}
                          unoptimized
                          className="rounded-full flex-shrink-0"
                        />
                      )}
                      <span>{pod.displayName}</span>
                      <span className="text-xs opacity-60">{podWatched}/{podEps.length}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedPodcastId && podcastEpisodes.length > 0 && (
              <>
                {/* Progress bar */}
                <section className="card-primary mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-body font-medium">
                      {watchedCount} / {podcastEpisodes.length} watched
                    </span>
                    <span className="text-meta">{progressPct}%</span>
                  </div>
                  <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%`, backgroundColor: 'var(--accent-primary)' }}
                    />
                  </div>
                </section>

                {/* Filter tabs */}
                <section className="flex gap-2 mb-4 flex-wrap">
                  {(['all', 'unwatched', 'watched'] as FilterOption[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-4 py-2 rounded-2xl text-sm font-medium transition-all duration-300 ${
                        filter === f ? 'pill-selected' : 'pill-enhanced'
                      }`}
                    >
                      {f === 'all' ? `All (${podcastEpisodes.length})` : f === 'unwatched' ? `Unwatched (${podcastEpisodes.length - watchedCount})` : `Watched (${watchedCount})`}
                    </button>
                  ))}
                  {podcastSites.size > 1 && (
                    <>
                      <span className="self-center mx-1" style={{ color: 'var(--border-primary)' }}>|</span>
                      {(['all', 'youtube', 'patreon'] as SiteFilter[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setSiteFilter(s)}
                          className={`px-4 py-2 rounded-2xl text-sm font-medium transition-all duration-300 ${
                            siteFilter === s ? 'pill-selected' : 'pill-enhanced'
                          }`}
                        >
                          {s === 'all' ? 'All sources' : s === 'youtube' ? 'YouTube' : 'Patreon'}
                        </button>
                      ))}
                    </>
                  )}
                </section>

                {/* Table */}
                <section>
                  {filteredSortedEpisodes.length === 0 ? (
                    <div className="card-primary text-center">
                      <p className="text-body">
                        {filter === 'watched' ? 'No watched episodes yet.' : 'All episodes are watched!'}
                      </p>
                    </div>
                  ) : (
                    <div
                      className="rounded-2xl overflow-hidden"
                      style={{ border: '1px solid var(--border-primary)', backgroundColor: 'var(--surface-primary)' }}
                    >
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ backgroundColor: 'var(--surface-secondary)' }}>
                            {/* Watched toggle col — not sortable */}
                            <th className="px-4 py-3 w-10" style={thStyle} />

                            {/* Title */}
                            <th
                              className={thClass}
                              style={thStyle}
                              onClick={() => handleSort('title')}
                            >
                              <span className="flex items-center gap-1.5">
                                Title
                                <SortIcon column="title" sortCol={sortCol} sortDir={sortDir} />
                              </span>
                            </th>

                            {/* Date */}
                            <th
                              className={`${thClass} hidden sm:table-cell w-36`}
                              style={thStyle}
                              onClick={() => handleSort('date')}
                            >
                              <span className="flex items-center gap-1.5">
                                Date
                                <SortIcon column="date" sortCol={sortCol} sortDir={sortDir} />
                              </span>
                            </th>

                            {/* Duration */}
                            <th
                              className={`${thClass} hidden md:table-cell w-24`}
                              style={thStyle}
                              onClick={() => handleSort('duration')}
                            >
                              <span className="flex items-center gap-1.5">
                                Duration
                                <SortIcon column="duration" sortCol={sortCol} sortDir={sortDir} />
                              </span>
                            </th>

                            {/* Watch link col — not sortable */}
                            <th className="px-4 py-3 w-20" style={thStyle} />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSortedEpisodes.map((ep, i) => {
                            const isEpWatched = watched.has(ep.video_id);
                            const isLast = i === filteredSortedEpisodes.length - 1;
                            return (
                              <tr
                                key={ep.id}
                                className="transition-colors duration-150 hover:bg-white/[0.02]"
                                style={{
                                  borderTop: i === 0 ? undefined : '1px solid var(--border-secondary)',
                                  opacity: isEpWatched ? 0.45 : 1,
                                }}
                              >
                                {/* Checkbox */}
                                <td className="px-4 py-3">
                                  <button
                                    onClick={() => handleToggle(ep.video_id)}
                                    className="flex items-center justify-center transition-transform duration-150 hover:scale-110"
                                    aria-label={isEpWatched ? 'Mark as unwatched' : 'Mark as watched'}
                                  >
                                    {isEpWatched ? (
                                      <CheckCircle2 className="w-4.5 h-4.5 w-[18px] h-[18px]" style={{ color: 'var(--success)' }} />
                                    ) : (
                                      <Circle className="w-[18px] h-[18px] text-gray-600 hover:text-gray-400" />
                                    )}
                                  </button>
                                </td>

                                {/* Title */}
                                <td className="px-4 py-3">
                                  <span
                                    className={`font-medium leading-snug ${
                                      isEpWatched ? 'line-through text-gray-500' : 'text-body'
                                    }`}
                                  >
                                    {ep.title}
                                  </span>
                                  {/* Date shown inline on mobile */}
                                  <span className="sm:hidden block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                    {formatDate(ep.publication_date)}
                                    {ep.duration_seconds ? ` · ${formatDuration(ep.duration_seconds)}` : ''}
                                  </span>
                                </td>

                                {/* Date */}
                                <td className="px-4 py-3 hidden sm:table-cell whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                                  {formatDate(ep.publication_date)}
                                </td>

                                {/* Duration */}
                                <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap tabular-nums" style={{ color: 'var(--text-muted)' }}>
                                  {formatDuration(ep.duration_seconds)}
                                </td>

                                {/* Watch */}
                                <td className="px-4 py-3">
                                  <a
                                    href={getEpisodeUrl(ep)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`flex items-center gap-1.5 text-sm transition-colors whitespace-nowrap ${
                                      isPatreon(ep)
                                        ? 'text-orange-400 hover:text-orange-300'
                                        : 'text-red-400 hover:text-red-300'
                                    }`}
                                    aria-label={`Watch "${ep.title}"`}
                                  >
                                    <Play className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                                    <span className="hidden sm:inline">Watch</span>
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}

            {selectedPodcastId && podcastEpisodes.length === 0 && (
              <section>
                <div className="card-primary text-center">
                  <Tv2 className="w-20 h-20 text-gray-500 mx-auto mb-6" />
                  <h2 className="heading-secondary">No episodes yet</h2>
                  <p className="text-body max-w-lg mx-auto">
                    Episodes will appear here once they've been discovered.
                  </p>
                </div>
              </section>
            )}
          </>
      </div>

    </div>
  );
}
