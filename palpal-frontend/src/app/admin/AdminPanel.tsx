'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Ban, CheckCircle, ChevronDown, ChevronUp,
  Clock, Loader2, Pause, Play, RefreshCw, RotateCcw, Settings, SkipForward,
  Trash2, X, Zap, Search,
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
  blacklisted: boolean;
  podcast_id: string;
  podcast_name: string;
  source_name: string;
  chunk_count: number;
  duration_seconds: number | null;
  youtube_url: string;
}

interface SchedulerStatus {
  running: boolean;
  paused: boolean;
  jobs: { id: string; next_run: string | null }[];
}

interface PipelineSettings {
  auto_discover: boolean;
  auto_download: boolean;
  auto_transcribe: boolean;
}

interface StatusCounts {
  discovered?: number;
  downloading?: number;
  downloaded?: number;
  transcribing?: number;
  processed?: number;
  failed?: number;
}

type StatusFilter = 'all' | 'discovered' | 'downloading' | 'downloaded' | 'transcribing' | 'processed' | 'failed' | 'blacklisted';

// --------------------------------------------------------------------------- //
// Helpers                                                                      //
// --------------------------------------------------------------------------- //

const STATUS_COLORS: Record<string, string> = {
  discovered:   'text-blue-400 bg-blue-400/10 border-blue-400/20',
  downloading:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  downloaded:   'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  transcribing: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  processed:    'text-green-400 bg-green-400/10 border-green-400/20',
  failed:       'text-red-400 bg-red-400/10 border-red-400/20',
};

function StatusBadge({ status, blacklisted }: { status: string; blacklisted?: boolean }) {
  const cls = STATUS_COLORS[status] || 'text-gray-400 bg-gray-400/10 border-gray-400/20';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
        {status}
      </span>
      {blacklisted && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium text-orange-400 bg-orange-400/10 border-orange-400/20">
          <Ban className="w-2.5 h-2.5" />
        </span>
      )}
    </span>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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

const RETRYABLE = new Set(['failed', 'transcribing', 'downloaded', 'downloading']);
const PROCESSABLE = new Set(['discovered', 'downloaded']);

// --------------------------------------------------------------------------- //
// Component                                                                    //
// --------------------------------------------------------------------------- //

export default function AdminPanel() {
  const podcasts = getAllStaticPodcastConfigs().filter(p => p.enabled);

  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [counts, setCounts] = useState<StatusCounts>({});
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [titleFilter, setTitleFilter] = useState('');
  const [podcastFilter, setPodcastFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [pipelineSettings, setPipelineSettings] = useState<PipelineSettings>({
    auto_discover: true, auto_download: true, auto_transcribe: true,
  });
  const [settingPending, setSettingPending] = useState<string | null>(null);

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
      const [schedRes, statusRes, epsRes, settingsRes] = await Promise.all([
        fetch('/api/admin/scheduler/status'),
        fetch('/api/admin/status'),
        fetch('/api/episodes'),
        fetch('/api/admin/pipeline-settings'),
      ]);
      if (schedRes.ok) setScheduler(await schedRes.json());
      if (statusRes.ok) {
        const s = await statusRes.json();
        setCounts(s.counts || {});
      }
      if (epsRes.ok) setEpisodes(await epsRes.json());
      if (settingsRes.ok) setPipelineSettings(await settingsRes.json());
    } catch (e) {
      console.error('Admin fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bustEpisodesCache]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(true, true), 8000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // --------------------------------------------------------------------------- //
  // Actions                                                                      //
  // --------------------------------------------------------------------------- //

  async function togglePipelineSetting(key: keyof PipelineSettings) {
    setSettingPending(key);
    try {
      const res = await fetch('/api/admin/pipeline-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !pipelineSettings[key] }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPipelineSettings(await res.json());
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setSettingPending(null);
    }
  }

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
      showToast(`Discovery started${podcastId ? ` for ${podcastId}` : ''}`);
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
      showToast('Episode queued');
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

  async function retranscribeEpisode(id: string) {
    const key = `retranscribe-${id}`;
    setPending(key, true);
    try {
      const res = await fetch(`/api/admin/episodes/${id}/retranscribe`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast('Re-transcription queued');
      await fetchAll(true, true);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  async function blacklistEpisode(id: string, blacklisted: boolean) {
    const key = `blacklist-${id}`;
    setPending(key, true);
    try {
      const action = blacklisted ? 'blacklist' : 'unblacklist';
      const res = await fetch(`/api/admin/episodes/${id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast(blacklisted ? 'Episode blacklisted' : 'Blacklist removed');
      await fetchAll(true, true);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  async function deleteEpisode(id: string) {
    const key = `delete-${id}`;
    setPending(key, true);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/admin/episodes/${id}/delete`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast('Episode deleted');
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      await fetchAll(true, true);
    } catch (e) {
      showToast(`Failed: ${e}`, false);
    } finally {
      setPending(key, false);
    }
  }

  async function bulkAction(action: 'retry' | 'process' | 'blacklist' | 'unblacklist' | 'delete' | 'retranscribe') {
    if (selectedIds.size === 0) return;
    setBulkPending(true);
    setConfirmBulkDelete(false);
    try {
      const res = await fetch('/api/admin/episodes/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode_ids: [...selectedIds], action }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      showToast(`${data.queued} / ${data.total} episodes: ${action}`);
      setSelectedIds(new Set());
      await fetchAll(true, true);
    } catch (e) {
      showToast(`Bulk action failed: ${e}`, false);
    } finally {
      setBulkPending(false);
    }
  }

  // --------------------------------------------------------------------------- //
  // Selection helpers                                                            //
  // --------------------------------------------------------------------------- //

  const filteredEpisodes = useMemo(() => {
    let result = episodes;
    if (statusFilter === 'blacklisted') {
      result = result.filter(e => e.blacklisted);
    } else if (statusFilter !== 'all') {
      result = result.filter(e => e.status === statusFilter);
    }
    if (podcastFilter !== 'all') result = result.filter(e => e.podcast_id === podcastFilter);
    if (titleFilter.trim()) {
      const q = titleFilter.toLowerCase();
      result = result.filter(e => e.title.toLowerCase().includes(q));
    }
    return result;
  }, [episodes, statusFilter, podcastFilter, titleFilter]);

  const blacklistedCount = useMemo(() => episodes.filter(e => e.blacklisted).length, [episodes]);

  const allFilteredSelected = filteredEpisodes.length > 0 &&
    filteredEpisodes.every(e => selectedIds.has(e.id));
  const someFilteredSelected = filteredEpisodes.some(e => selectedIds.has(e.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredEpisodes.forEach(e => next.delete(e.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredEpisodes.forEach(e => next.add(e.id));
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  const selectedInView = filteredEpisodes.filter(e => selectedIds.has(e.id));
  const canBulkRetry = selectedInView.some(e => RETRYABLE.has(e.status));
  const canBulkProcess = selectedInView.some(e => PROCESSABLE.has(e.status));
  const canBulkBlacklist = selectedInView.some(e => !e.blacklisted);
  const canBulkUnblacklist = selectedInView.some(e => e.blacklisted);
  const canBulkRetranscribe = selectedInView.some(e => e.status === 'processed');

  const STATUS_TABS: StatusFilter[] = ['all', 'discovered', 'downloading', 'downloaded', 'transcribing', 'failed', 'processed', 'blacklisted'];

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

      {/* Scheduler + Counts row */}
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
          <div className="grid grid-cols-3 gap-2">
            {(['discovered', 'downloading', 'downloaded', 'transcribing', 'processed', 'failed'] as const).map(s => (
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

      {/* Pipeline Controls */}
      <div className="card-primary">
        <h2 className="heading-secondary flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-orange-400" />
          Pipeline Controls
        </h2>
        <div className="space-y-3">
          {(
            [
              { key: 'auto_discover',   label: 'Auto Discover',   desc: 'Scheduled discovery runs every 24h' },
              { key: 'auto_download',   label: 'Auto Download',   desc: 'Newly discovered episodes are downloaded automatically' },
              { key: 'auto_transcribe', label: 'Auto Transcribe', desc: 'Downloaded episodes are submitted to blurb automatically' },
            ] as const
          ).map(({ key, label, desc }) => {
            const enabled = pipelineSettings[key];
            const pending = settingPending === key;
            return (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                  <div className="text-xs text-gray-500">{desc}</div>
                </div>
                <button
                  onClick={() => togglePipelineSetting(key)}
                  disabled={pending}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                    enabled ? 'bg-orange-500 border-orange-500' : 'bg-gray-700 border-gray-600'
                  }`}
                  aria-checked={enabled}
                  role="switch"
                >
                  <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform duration-200 ${
                    enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Discover */}
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

      {/* Episodes table */}
      <div className="card-primary">
        <button
          className="flex items-center justify-between w-full mb-4"
          onClick={() => setEpisodesExpanded(e => !e)}
        >
          <h2 className="heading-secondary">
            Episodes
            {statusFilter !== 'all' && (
              <span className="ml-2 text-sm text-orange-400 font-normal">({statusFilter})</span>
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
              {STATUS_TABS.map(tab => {
                const count = tab === 'all'
                  ? episodes.length
                  : tab === 'blacklisted'
                  ? blacklistedCount
                  : (counts[tab as keyof StatusCounts] ?? 0);
                return (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                      statusFilter === tab
                        ? tab === 'blacklisted'
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                          : 'bg-orange-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {tab === 'blacklisted' && <Ban className="w-3 h-3 inline mr-1" />}
                    {tab} ({count})
                  </button>
                );
              })}
            </div>

            {/* Search + podcast filter row */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={titleFilter}
                  onChange={e => setTitleFilter(e.target.value)}
                  placeholder="Filter by title..."
                  className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500/50"
                />
                {titleFilter && (
                  <button onClick={() => setTitleFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <select
                value={podcastFilter}
                onChange={e => setPodcastFilter(e.target.value)}
                className="py-2 px-3 text-sm rounded-lg border border-gray-700 bg-gray-800 text-gray-200 focus:outline-none focus:border-orange-500/50"
              >
                <option value="all">All podcasts</option>
                {podcasts.map(p => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                <span className="text-sm text-orange-300 font-medium flex-1 min-w-0">
                  {selectedIds.size} selected
                </span>
                {canBulkRetry && (
                  <button
                    onClick={() => bulkAction('retry')}
                    disabled={bulkPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border border-yellow-600/30 transition-all disabled:opacity-50"
                  >
                    {bulkPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Retry
                  </button>
                )}
                {canBulkProcess && (
                  <button
                    onClick={() => bulkAction('process')}
                    disabled={bulkPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-600/30 transition-all disabled:opacity-50"
                  >
                    {bulkPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Process
                  </button>
                )}
                {canBulkRetranscribe && (
                  <button
                    onClick={() => bulkAction('retranscribe')}
                    disabled={bulkPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-600/30 transition-all disabled:opacity-50"
                  >
                    {bulkPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Re-transcribe
                  </button>
                )}
                {canBulkBlacklist && (
                  <button
                    onClick={() => bulkAction('blacklist')}
                    disabled={bulkPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-600/30 transition-all disabled:opacity-50"
                  >
                    {bulkPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                    Blacklist
                  </button>
                )}
                {canBulkUnblacklist && (
                  <button
                    onClick={() => bulkAction('unblacklist')}
                    disabled={bulkPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-gray-600/20 hover:bg-gray-600/30 text-gray-300 border border-gray-600/30 transition-all disabled:opacity-50"
                  >
                    {bulkPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                    Unblacklist
                  </button>
                )}
                {/* Delete with confirm */}
                {confirmBulkDelete ? (
                  <>
                    <span className="text-xs text-red-300">Delete {selectedIds.size}?</span>
                    <button
                      onClick={() => bulkAction('delete')}
                      disabled={bulkPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-red-600/30 text-red-200 border border-red-600/50 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmBulkDelete(false)}
                      className="px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    disabled={bulkPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-600/30 transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                )}
                <button
                  onClick={() => { setSelectedIds(new Set()); setConfirmBulkDelete(false); }}
                  className="text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-700">
                    <th className="pb-2 pr-3 w-8">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-orange-500 rounded border-gray-600 bg-gray-700 focus:ring-orange-500 cursor-pointer"
                      />
                    </th>
                    <th className="pb-2 pr-4 text-meta font-medium">Title</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Podcast</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Status</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Date</th>
                    <th className="pb-2 pr-4 text-meta font-medium">Length</th>
                    <th className="pb-2 text-meta font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredEpisodes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-meta">
                        No episodes match the current filters
                      </td>
                    </tr>
                  )}
                  {filteredEpisodes.map(ep => (
                    <tr
                      key={ep.id}
                      className={`hover:bg-gray-800/30 transition-colors ${selectedIds.has(ep.id) ? 'bg-orange-500/5' : ''} ${ep.blacklisted ? 'opacity-50' : ''}`}
                    >
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(ep.id)}
                          onChange={() => toggleSelect(ep.id)}
                          className="w-4 h-4 text-orange-500 rounded border-gray-600 bg-gray-700 focus:ring-orange-500 cursor-pointer"
                        />
                      </td>
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
                        <StatusBadge status={ep.status} blacklisted={ep.blacklisted} />
                      </td>
                      <td className="py-2 pr-4 text-meta whitespace-nowrap text-xs">
                        {ep.publication_date ?? '—'}
                      </td>
                      <td className="py-2 pr-4 text-meta whitespace-nowrap text-xs">
                        {formatDuration(ep.duration_seconds)}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1">
                          {/* Process */}
                          {(ep.status === 'discovered' || ep.status === 'downloaded') && (
                            <button
                              onClick={() => processEpisode(ep.id)}
                              disabled={!!actionPending[`process-${ep.id}`]}
                              title={ep.status === 'downloaded' ? 'Submit to transcriber' : 'Download and transcribe'}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-600/30 transition-all disabled:opacity-50"
                            >
                              {actionPending[`process-${ep.id}`]
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Play className="w-3 h-3" />
                              }
                              {ep.status === 'downloaded' ? 'Transcribe' : 'Process'}
                            </button>
                          )}
                          {/* Retry */}
                          {RETRYABLE.has(ep.status) && ep.status !== 'downloaded' && (
                            <button
                              onClick={() => retryEpisode(ep.id)}
                              disabled={!!actionPending[`retry-${ep.id}`]}
                              title="Reset and retry"
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border border-yellow-600/30 transition-all disabled:opacity-50"
                            >
                              {actionPending[`retry-${ep.id}`]
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                              Retry
                            </button>
                          )}
                          {/* Re-transcribe */}
                          {ep.status === 'processed' && (
                            <button
                              onClick={() => retranscribeEpisode(ep.id)}
                              disabled={!!actionPending[`retranscribe-${ep.id}`]}
                              title="Delete transcript and re-transcribe"
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-600/30 transition-all disabled:opacity-50"
                            >
                              {actionPending[`retranscribe-${ep.id}`]
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RotateCcw className="w-3 h-3" />
                              }
                              Re-transcribe
                            </button>
                          )}
                          {/* Chunk count */}
                          {ep.status === 'processed' && ep.chunk_count > 0 && (
                            <span className="text-xs text-green-400 px-1">{ep.chunk_count}</span>
                          )}
                          {/* Separator */}
                          <span className="text-gray-700">|</span>
                          {/* Blacklist toggle */}
                          <button
                            onClick={() => blacklistEpisode(ep.id, !ep.blacklisted)}
                            disabled={!!actionPending[`blacklist-${ep.id}`]}
                            title={ep.blacklisted ? 'Remove blacklist' : 'Blacklist this episode'}
                            className={`p-1 rounded transition-all disabled:opacity-50 ${
                              ep.blacklisted
                                ? 'text-orange-400 bg-orange-400/10 hover:bg-orange-400/20'
                                : 'text-gray-500 hover:text-orange-400 hover:bg-orange-400/10'
                            }`}
                          >
                            {actionPending[`blacklist-${ep.id}`]
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Ban className="w-3 h-3" />
                            }
                          </button>
                          {/* Delete with confirm */}
                          {confirmDeleteId === ep.id ? (
                            <>
                              <button
                                onClick={() => deleteEpisode(ep.id)}
                                disabled={!!actionPending[`delete-${ep.id}`]}
                                className="px-2 py-1 rounded text-xs bg-red-600/30 text-red-200 border border-red-600/50 disabled:opacity-50"
                              >
                                {actionPending[`delete-${ep.id}`]
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : 'Confirm'
                                }
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="p-1 rounded text-gray-500 hover:text-gray-300"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(ep.id)}
                              title="Delete episode"
                              className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
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
