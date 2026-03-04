'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  Clock, Loader2, Pause, Play, RefreshCw, SkipForward, Zap,
} from 'lucide-react';
import { getAllStaticPodcastConfigs } from '@/lib/static-podcasts';

// --------------------------------------------------------------------------- //
// Types                                                                        //
// --------------------------------------------------------------------------- //

interface EpisodeRow {
  id: string;
  video_id: string;
  title: string;
  publication_date: string | null;
  status: string;
  error_message: string | null;
  podcast_id: string;
  podcast_name: string;
  source_name: string;
  chunk_count: number;
  youtube_url: string;
}

interface SchedulerStatus {
  running: boolean;
  paused: boolean;
  jobs: { id: string; next_run: string | null }[];
}

interface StatusCounts {
  discovered?: number;
  downloading?: number;
  transcribing?: number;
  processed?: number;
  failed?: number;
}

type StatusFilter = 'all' | 'discovered' | 'downloading' | 'transcribing' | 'processed' | 'failed';

// --------------------------------------------------------------------------- //
// Helpers                                                                      //
// --------------------------------------------------------------------------- //

const STATUS_COLORS: Record<string, string> = {
  discovered:   'text-blue-400 bg-blue-400/10 border-blue-400/20',
  downloading:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  transcribing: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  processed:    'text-green-400 bg-green-400/10 border-green-400/20',
  failed:       'text-red-400 bg-red-400/10 border-red-400/20',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || 'text-gray-400 bg-gray-400/10 border-gray-400/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function formatNextRun(iso: string | null): string {
  if (!iso) return 'paused';
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

// --------------------------------------------------------------------------- //
// Component                                                                    //
// --------------------------------------------------------------------------- //

export default function AdminPanel() {
  const podcasts = getAllStaticPodcastConfigs().filter(p => p.enabled);

  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [counts, setCounts] = useState<StatusCounts>({});
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Collapsible episodes table
  const [episodesExpanded, setEpisodesExpanded] = useState(true);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const setPending = (key: string, val: boolean) =>
    setActionPending(prev => ({ ...prev, [key]: val }));

  // --------------------------------------------------------------------------- //
  // Data fetching                                                                //
  // --------------------------------------------------------------------------- //

  // Bust conductor's in-memory episodes cache so status changes appear immediately.
  const bustEpisodesCache = useCallback(async () => {
    try {
      await fetch('/api/admin/episodes/cache/bust', { method: 'POST' });
    } catch { /* best-effort */ }
  }, []);

  const fetchAll = useCallback(async (silent = false, bustCache = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      if (bustCache) await bustEpisodesCache();
      const [schedRes, statusRes, epsRes] = await Promise.all([
        fetch('/api/admin/scheduler/status'),
        fetch('/api/admin/status'),
        fetch('/api/episodes'),
      ]);
      if (schedRes.ok) setScheduler(await schedRes.json());
      if (statusRes.ok) {
        const s = await statusRes.json();
        setCounts(s.counts || {});
      }
      if (epsRes.ok) setEpisodes(await epsRes.json());
    } catch (e) {
      console.error('Admin fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bustEpisodesCache]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(true), 8000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // --------------------------------------------------------------------------- //
  // Actions                                                                      //
  // --------------------------------------------------------------------------- //

  async function toggleScheduler() {
    const key = 'scheduler';
    setPending(key, true);
    try {
      const action = scheduler?.paused ? 'resume' : 'pause';
      const res = await fetch(`/api/admin/scheduler/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await fetchAll(true);
      showToast(`Scheduler ${action}d`);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  async function discover(podcastId?: string) {
    const key = `discover-${podcastId || 'all'}`;
    setPending(key, true);
    try {
      const qs = new URLSearchParams({ auto_queue: 'false' });
      if (podcastId) qs.set('podcast_id', podcastId);
      const res = await fetch(`/api/admin/discover?${qs}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast(`Discovery started${podcastId ? ` for ${podcastId}` : ''} (episodes added as "discovered")`);
      setTimeout(() => fetchAll(true, true), 3000);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  async function processEpisode(id: string) {
    const key = `process-${id}`;
    setPending(key, true);
    try {
      const res = await fetch(`/api/admin/episodes/${id}/process`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast('Episode queued for processing');
      await fetchAll(true, true);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  async function retryEpisode(id: string) {
    const key = `retry-${id}`;
    setPending(key, true);
    try {
      const res = await fetch(`/api/admin/episodes/${id}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast('Episode reset and queued');
      await fetchAll(true, true);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  // --------------------------------------------------------------------------- //
  // Derived data                                                                 //
  // --------------------------------------------------------------------------- //

  const filteredEpisodes = statusFilter === 'all'
    ? episodes
    : episodes.filter(e => e.status === statusFilter);

  const STATUS_TABS: StatusFilter[] = ['all', 'discovered', 'downloading', 'transcribing', 'failed', 'processed'];

  // --------------------------------------------------------------------------- //
  // Render                                                                       //
  // --------------------------------------------------------------------------- //

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg border shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
          toast.ok
            ? 'bg-green-900/90 border-green-600 text-green-200'
            : 'bg-red-900/90 border-red-600 text-red-200'
        }`}>
          {toast.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="heading-primary text-2xl">Conductor Admin</h1>
        <button
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-orange-400 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Scheduler + Counts row                                               */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Scheduler card */}
        <div className="card-primary">
          <div className="flex items-center justify-between mb-4">
            <h2 className="heading-secondary flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-400" />
              Scheduler
            </h2>
            <span className={`text-xs font-medium px-2 py-1 rounded border ${
              scheduler?.paused
                ? 'text-orange-400 bg-orange-400/10 border-orange-400/20'
                : 'text-green-400 bg-green-400/10 border-green-400/20'
            }`}>
              {scheduler?.paused ? 'PAUSED' : 'RUNNING'}
            </span>
          </div>

          {scheduler?.jobs.map(job => (
            <div key={job.id} className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-400 capitalize">{job.id}</span>
              <span className="text-meta flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatNextRun(job.next_run)}
              </span>
            </div>
          ))}

          <button
            onClick={toggleScheduler}
            disabled={actionPending['scheduler']}
            className={`mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              scheduler?.paused
                ? 'bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-600/30'
                : 'bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-600/30'
            }`}
          >
            {actionPending['scheduler']
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : scheduler?.paused
                ? <><Play className="w-4 h-4" /> Resume Scheduler</>
                : <><Pause className="w-4 h-4" /> Pause Scheduler</>
            }
          </button>
        </div>

        {/* Status counts card */}
        <div className="card-primary">
          <h2 className="heading-secondary flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-orange-400" />
            Episode Counts
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(['discovered', 'downloading', 'transcribing', 'processed', 'failed'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  statusFilter === s
                    ? STATUS_COLORS[s]
                    : 'border-gray-700 hover:border-gray-500'
                }`}
              >
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {counts[s] ?? 0}
                </div>
                <div className="text-xs text-gray-400 capitalize">{s}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Podcasts — per-podcast discover buttons                              */}
      {/* ------------------------------------------------------------------- */}
      <div className="card-primary">
        <h2 className="heading-secondary flex items-center gap-2 mb-4">
          <SkipForward className="w-4 h-4 text-orange-400" />
          Discover New Episodes
        </h2>
        <p className="text-meta text-sm mb-4">
          Runs yt-dlp and adds newly found episodes as <strong className="text-blue-400">discovered</strong> without automatically processing them.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {podcasts.map(p => (
            <button
              key={p.id}
              onClick={() => discover(p.id)}
              disabled={!!actionPending[`discover-${p.id}`]}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-700 hover:border-orange-500/50 text-sm transition-all group disabled:opacity-50"
            >
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {p.displayName}
              </span>
              {actionPending[`discover-${p.id}`]
                ? <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                : <Play className="w-4 h-4 text-gray-500 group-hover:text-orange-400 transition-colors" />
              }
            </button>
          ))}
          <button
            onClick={() => discover()}
            disabled={!!actionPending['discover-all']}
            className="flex items-center justify-between px-4 py-3 rounded-lg border border-orange-500/30 hover:border-orange-500/60 text-sm transition-all group disabled:opacity-50 col-span-full"
          >
            <span className="font-medium text-orange-400">Discover All Podcasts</span>
            {actionPending['discover-all']
              ? <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
              : <Play className="w-4 h-4 text-orange-400" />
            }
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Episodes table                                                       */}
      {/* ------------------------------------------------------------------- */}
      <div className="card-primary">
        <button
          className="flex items-center justify-between w-full mb-4"
          onClick={() => setEpisodesExpanded(e => !e)}
        >
          <h2 className="heading-secondary">
            Episodes
            {statusFilter !== 'all' && (
              <span className="ml-2 text-sm text-orange-400 font-normal">
                ({statusFilter})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2 text-gray-400">
            <span className="text-sm">{filteredEpisodes.length}</span>
            {episodesExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {episodesExpanded && (
          <>
            {/* Status filter tabs */}
            <div className="flex flex-wrap gap-2 mb-4">
              {STATUS_TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    statusFilter === tab
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tab === 'all' ? `All (${episodes.length})` : `${tab} (${counts[tab as keyof StatusCounts] ?? 0})`}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-700">
                    <th className="pb-2 pr-4 text-meta font-medium">Title</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Podcast</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Status</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Date</th>
                    <th className="pb-2 text-meta font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredEpisodes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-meta">
                        No episodes in this status
                      </td>
                    </tr>
                  )}
                  {filteredEpisodes.map(ep => (
                    <tr key={ep.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="py-2 pr-4">
                        <a
                          href={ep.youtube_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-orange-400 transition-colors line-clamp-1 max-w-xs block"
                          style={{ color: 'var(--text-primary)' }}
                          title={ep.title}
                        >
                          {ep.title}
                        </a>
                        {ep.error_message && (
                          <p className="text-xs text-red-400 mt-0.5 line-clamp-1" title={ep.error_message}>
                            {ep.error_message}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-meta whitespace-nowrap">{ep.podcast_name}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <StatusBadge status={ep.status} />
                      </td>
                      <td className="py-2 pr-4 text-meta whitespace-nowrap text-xs">
                        {ep.publication_date ?? '—'}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {ep.status === 'discovered' && (
                          <button
                            onClick={() => processEpisode(ep.id)}
                            disabled={!!actionPending[`process-${ep.id}`]}
                            className="flex items-center gap-1 px-3 py-1 rounded text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-600/30 transition-all disabled:opacity-50"
                          >
                            {actionPending[`process-${ep.id}`]
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Play className="w-3 h-3" />
                            }
                            Process
                          </button>
                        )}
                        {ep.status === 'failed' && (
                          <button
                            onClick={() => retryEpisode(ep.id)}
                            disabled={!!actionPending[`retry-${ep.id}`]}
                            className="flex items-center gap-1 px-3 py-1 rounded text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-600/30 transition-all disabled:opacity-50"
                          >
                            {actionPending[`retry-${ep.id}`]
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RefreshCw className="w-3 h-3" />
                            }
                            Retry
                          </button>
                        )}
                        {ep.status === 'processed' && ep.chunk_count > 0 && (
                          <span className="text-xs text-green-400">{ep.chunk_count} chunks</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
