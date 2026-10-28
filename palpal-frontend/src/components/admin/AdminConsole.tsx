'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Command,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Mic2,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { AdminContext, type AdminApi } from './AdminContext';
import { api, qs } from './api';
import type {
  ActionResult,
  AttentionData,
  Episode,
  EpisodeFilters,
  EpisodePage,
  JobHistoryFilters,
  JobHistoryPage,
  JobsPage,
  Overview,
  Podcast,
  ViewKey,
  WhatsNewEntry,
} from './types';
import { useAdminLive } from './useAdminLive';
import {
  Button,
  ConfirmDialog,
  KeyHint,
  Spinner,
  ToastViewport,
  fmtRelative,
  type ConfirmRequest,
  type ToastItem,
} from './ui';
import OverviewView from './OverviewView';
import AttentionView from './AttentionView';
import EpisodesView from './EpisodesView';
import JobsView from './JobsView';
import PodcastsView from './PodcastsView';
import ContentView from './ContentView';
import SettingsView from './SettingsView';
import EpisodeDrawer from './EpisodeDrawer';
import JobDrawer from './JobDrawer';
import CommandPalette, { type CommandItem } from './CommandPalette';

const VIEW_META: Record<ViewKey, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Live pipeline control and recent activity' },
  attention: { title: 'Attention', subtitle: 'Grouped failures and orphaned episodes' },
  episodes: { title: 'Episodes', subtitle: 'Search, inspect, and act on every episode' },
  jobs: { title: 'Jobs', subtitle: 'The worker queue and complete job history' },
  podcasts: { title: 'Podcasts', subtitle: 'Sources, ordering, and per-podcast controls' },
  content: { title: 'Content', subtitle: "What's New entries and search placeholders" },
  settings: { title: 'Settings', subtitle: 'Pipeline behaviour, scheduler, and danger zone' },
};

const DEFAULT_EPISODE_FILTERS: EpisodeFilters = {
  status: 'all',
  q: '',
  podcastId: 'all',
  site: 'all',
  sort: 'newest',
  page: 1,
  pageSize: 50,
};

const DEFAULT_HISTORY_FILTERS: JobHistoryFilters = {
  status: 'all',
  kind: 'all',
  q: '',
  page: 1,
  pageSize: 25,
};

let toastCounter = 0;

export default function AdminConsole() {
  const live = useAdminLive();

  const [view, setView] = useState<ViewKey>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [podcasts, setPodcasts] = useState<Podcast[] | null>(null);
  const [episodePage, setEpisodePage] = useState<EpisodePage | null>(null);
  const [jobsPage, setJobsPage] = useState<JobsPage | null>(null);
  const [jobHistory, setJobHistory] = useState<JobHistoryPage | null>(null);
  const [updates, setUpdates] = useState<WhatsNewEntry[] | null>(null);
  const [placeholders, setPlaceholders] = useState<string[] | null>(null);
  const [attentionData, setAttentionData] = useState<AttentionData | null>(null);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [showIgnoredAttention, setShowIgnoredAttention] = useState(false);

  const [overviewLoading, setOverviewLoading] = useState(true);
  const [podcastsLoading, setPodcastsLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);

  const [episodeFilters, setEpisodeFilters] = useState<EpisodeFilters>(DEFAULT_EPISODE_FILTERS);
  const [historyFilters, setHistoryFilters] = useState<JobHistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string | null>(null);
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set());
  const [activeJobsPage, setActiveJobsPage] = useState(1);
  const [drawerEpisodeId, setDrawerEpisodeId] = useState<string | null>(null);
  const [drawerSeed, setDrawerSeed] = useState<Episode | null>(null);
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [commandOpen, setCommandOpen] = useState(false);
  const [urlReady, setUrlReady] = useState(false);

  const pendingRef = useRef<Set<string>>(new Set());

  // Restore the console's view and filters from the URL so a refresh, bookmark,
  // or shared link lands on exactly the same slice of the pipeline.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextView = params.get('view') as ViewKey | null;
    if (nextView && nextView in VIEW_META) setView(nextView);

    const epPatch: Partial<EpisodeFilters> = {};
    const status = params.get('status');
    if (status) epPatch.status = status;
    const q = params.get('q');
    if (q) epPatch.q = q;
    const podcast = params.get('podcast');
    if (podcast) {
      epPatch.podcastId = podcast;
    }
    const selectedPod = params.get('pod_id');
    if (selectedPod) setSelectedPodcastId(selectedPod);
    const site = params.get('site');
    if (site) epPatch.site = site;
    const sort = params.get('sort');
    if (sort) epPatch.sort = sort;
    const epPage = parseInt(params.get('ep_page') ?? '', 10);
    if (Number.isFinite(epPage) && epPage > 0) epPatch.page = epPage;
    if (Object.keys(epPatch).length) setEpisodeFilters((prev) => ({ ...prev, ...epPatch }));

    const historyPatch: Partial<JobHistoryFilters> = {};
    const jobStatus = params.get('job_status');
    if (jobStatus) historyPatch.status = jobStatus;
    const jobKind = params.get('job_kind');
    if (jobKind) historyPatch.kind = jobKind;
    const jobQ = params.get('job_q');
    if (jobQ) historyPatch.q = jobQ;
    const jobPage = parseInt(params.get('job_page') ?? '', 10);
    if (Number.isFinite(jobPage) && jobPage > 0) historyPatch.page = jobPage;
    if (Object.keys(historyPatch).length) {
      setHistoryFilters((prev) => ({ ...prev, ...historyPatch }));
    }

    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    if (view !== 'overview') params.set('view', view);
    if (episodeFilters.status !== 'all') params.set('status', episodeFilters.status);
    if (episodeFilters.q) params.set('q', episodeFilters.q);
    if (episodeFilters.podcastId !== 'all') params.set('podcast', episodeFilters.podcastId);
    if (episodeFilters.site !== 'all') params.set('site', episodeFilters.site);
    if (episodeFilters.sort !== 'newest') params.set('sort', episodeFilters.sort);
    if (episodeFilters.page !== 1) params.set('ep_page', String(episodeFilters.page));
    if (historyFilters.status !== 'all') params.set('job_status', historyFilters.status);
    if (historyFilters.kind !== 'all') params.set('job_kind', historyFilters.kind);
    if (historyFilters.q) params.set('job_q', historyFilters.q);
    if (historyFilters.page !== 1) params.set('job_page', String(historyFilters.page));
    if (view === 'podcasts' && selectedPodcastId) params.set('pod_id', selectedPodcastId);

    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [urlReady, view, episodeFilters, historyFilters, selectedPodcastId]);

  const toast = useCallback((message: string, tone: ToastItem['tone'] = 'ok', options?: { detail?: string }) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone, detail: options?.detail }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, tone === 'error' ? 7000 : 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const isPending = useCallback((key: string) => pending.has(key), [pending]);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
      if (pendingRef.current.has(key)) return undefined;
      const started = new Set(pendingRef.current);
      started.add(key);
      pendingRef.current = started;
      setPending(started);
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast('Action failed', 'error', { detail: message });
        return undefined;
      } finally {
        const finished = new Set(pendingRef.current);
        finished.delete(key);
        pendingRef.current = finished;
        setPending(finished);
      }
    },
    [toast],
  );

  const refreshAll = useCallback(() => {
    live.bumpAll();
  }, [live]);

  // On the Podcasts page, source "last discovery" rows should update when a
  // discover job finishes. Elsewhere, don't refetch the podcast list on every
  // job-progress tick.
  const podcastJobsTick = view === 'podcasts' ? live.bumps.jobs : 0;

  // ------------------------------------------------------------------ data
  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    api<Overview>('/admin/overview')
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load overview', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.overview, toast]);

  useEffect(() => {
    if (view !== 'attention') return;
    let cancelled = false;
    setAttentionLoading(true);
    api<AttentionData>(`/admin/attention${showIgnoredAttention ? '?include_ignored=true' : ''}`)
      .then((data) => {
        if (!cancelled) setAttentionData(data);
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load attention inbox', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setAttentionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.episodes, live.bumps.overview, view, showIgnoredAttention, toast]);

  useEffect(() => {
    if (view !== 'episodes' && view !== 'podcasts') return;
    let cancelled = false;
    setPodcastsLoading(true);
    api<Podcast[]>('/admin/podcasts')
      .then((data) => {
        if (!cancelled) setPodcasts(data);
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load podcasts', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setPodcastsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.podcasts, podcastJobsTick, view, toast]);

  useEffect(() => {
    if (view !== 'episodes') return;
    let cancelled = false;
    setEpisodesLoading(true);
    const query = qs({
      status: episodeFilters.status,
      podcast_id: episodeFilters.podcastId,
      site: episodeFilters.site,
      q: episodeFilters.q,
      sort: episodeFilters.sort,
      page: episodeFilters.page,
      page_size: episodeFilters.pageSize,
    });
    api<EpisodePage>(`/admin/episodes${query}`)
      .then((data) => {
        if (cancelled) return;
        if (data.episodes.length === 0 && data.total > 0 && episodeFilters.page > 1) {
          setEpisodeFilters((prev) => ({
            ...prev,
            page: Math.max(1, Math.ceil(data.total / prev.pageSize)),
          }));
          return;
        }
        setEpisodePage(data);
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load episodes', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setEpisodesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.episodes, episodeFilters, view, toast]);

  useEffect(() => {
    if (view !== 'jobs') return;
    let cancelled = false;
    setJobsLoading(true);
    api<JobsPage>(`/admin/jobs?page=${activeJobsPage}&page_size=100`)
      .then((data) => {
        if (cancelled) return;
        if (data.active.length === 0 && data.active_total > 0 && activeJobsPage > 1) {
          setActiveJobsPage(Math.max(1, Math.ceil(data.active_total / data.page_size)));
          return;
        }
        setJobsPage(data);
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load job queue', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setJobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.jobs, view, activeJobsPage, toast]);

  useEffect(() => {
    if (view !== 'jobs') return;
    let cancelled = false;
    setHistoryLoading(true);
    const query = qs({
      status: historyFilters.status,
      kind: historyFilters.kind,
      q: historyFilters.q,
      page: historyFilters.page,
      page_size: historyFilters.pageSize,
    });
    api<JobHistoryPage>(`/admin/jobs/history${query}`)
      .then((data) => {
        if (cancelled) return;
        if (data.jobs.length === 0 && data.total > 0 && historyFilters.page > 1) {
          setHistoryFilters((prev) => ({
            ...prev,
            page: Math.max(1, Math.ceil(data.total / prev.pageSize)),
          }));
          return;
        }
        setJobHistory(data);
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load job history', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.jobs, historyFilters, view, toast]);

  useEffect(() => {
    if (view !== 'content') return;
    let cancelled = false;
    setContentLoading(true);
    Promise.all([
      api<WhatsNewEntry[]>('/whats-new?fresh=1'),
      api<string[]>('/search-placeholders?fresh=1'),
    ])
      .then(([entries, placeholderItems]) => {
        if (!cancelled) {
          setUpdates(entries);
          setPlaceholders(placeholderItems);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) toast('Could not load content', 'error', { detail: error.message });
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live.bumps.content, view, toast]);

  // --------------------------------------------------------------- actions
  const navigate = useCallback((next: ViewKey, options?: { episodeFilters?: Partial<EpisodeFilters>; podcastId?: string }) => {
    setView(next);
    if (options?.episodeFilters) {
      setEpisodeFilters((prev) => ({ ...prev, ...options.episodeFilters }));
    }
    if (options?.podcastId) {
      setSelectedPodcastId(options.podcastId);
    }
  }, []);

  const patchEpisodeFilters = useCallback((patch: Partial<EpisodeFilters>) => {
    setEpisodeFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchHistoryFilters = useCallback((patch: Partial<JobHistoryFilters>) => {
    setHistoryFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEpisodes(new Set());
  }, []);

  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedEpisodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openEpisode = useCallback((episode: Episode | string) => {
    if (typeof episode === 'string') {
      setDrawerSeed(null);
      setDrawerEpisodeId(episode);
    } else {
      setDrawerSeed(episode);
      setDrawerEpisodeId(episode.id);
    }
  }, []);

  const episodeAction = useCallback(
    async (action: string, id: string): Promise<boolean> => {
      const result = await run(`episode:${action}:${id}`, async () => {
        await api(`/admin/episodes/${id}/${action}`, { method: 'POST' });
        const labels: Record<string, string> = {
          process: 'Episode queued',
          retry: 'Episode queued for retry',
          retranscribe: 'Re-transcription queued',
          blacklist: 'Episode blacklisted',
          unblacklist: 'Blacklist removed',
          delete: 'Episode deleted',
        };
        toast(labels[action] ?? 'Done');
        refreshAll();
        return true;
      });
      return result === true;
    },
    [run, toast, refreshAll],
  );

  const bulkEpisodeAction = useCallback(
    async (
      action: string,
      ids: string[],
      options?: { allMatching?: boolean; filter?: EpisodeFilters },
    ) => {
      await run(`bulk:${action}`, async () => {
        const filter = options?.filter;
        const body = {
          action,
          episode_ids: ids,
          all_matching: Boolean(options?.allMatching),
          filter:
            options?.allMatching && filter
              ? {
                  status: filter.status,
                  podcast_id: filter.podcastId,
                  site: filter.site,
                  q: filter.q,
                }
              : null,
        };
        const result = await api<ActionResult>('/admin/episodes/bulk-action', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const verb =
          action === 'delete'
            ? 'Deleted'
            : action === 'blacklist' || action === 'unblacklist'
              ? 'Updated'
              : 'Queued';
        toast(`${verb} ${result.queued} of ${result.total} episode(s)`, result.queued > 0 ? 'ok' : 'error', {
          detail: result.results?.find((r) => !r.ok)?.detail,
        });
        clearSelection();
        refreshAll();
      });
    },
    [run, toast, clearSelection, refreshAll],
  );

  const jobAction = useCallback(
    async (action: 'cancel' | 'prioritize' | 'retry', id: string) => {
      await run(`job:${action}:${id}`, async () => {
        await api(`/admin/jobs/${id}/${action}`, { method: 'POST' });
        const labels = { cancel: 'Job cancelled', prioritize: 'Job moved to the front', retry: 'Job queued again' };
        toast(labels[action]);
        refreshAll();
      });
    },
    [run, toast, refreshAll],
  );

  const schedulerAction = useCallback(
    async (action: 'pause' | 'resume') => {
      await run('scheduler', async () => {
        await api(`/admin/scheduler/${action}`, { method: 'POST' });
        toast(action === 'pause' ? 'Processing paused' : 'Processing resumed');
        refreshAll();
      });
    },
    [run, toast, refreshAll],
  );

  const discover = useCallback(
    async (options: { podcast_id?: string; source_id?: string; auto_queue: boolean }) => {
      const suffix = options.auto_queue ? 'queue' : 'review';
      const key = options.source_id
        ? `discover:source:${options.source_id}`
        : options.podcast_id
          ? options.auto_queue
            ? `discover:${options.podcast_id}`
            : `discover-review:${options.podcast_id}`
          : `discover:all:${suffix}`;
      await run(key, async () => {
        const query = qs({
          podcast_id: options.podcast_id,
          source_id: options.source_id,
          auto_queue: options.auto_queue,
        });
        await api(`/admin/discover${query}`, { method: 'POST' });
        toast(options.auto_queue ? 'Discovery queued (auto-process on)' : 'Discovery queued (review only)');
        refreshAll();
      });
    },
    [run, toast, refreshAll],
  );

  const saveSettings = useCallback(
    async (patch: Record<string, boolean | number>) => {
      const keys = Object.keys(patch);
      const key = `setting:${keys[0] === 'min_episode_duration_seconds' ? 'min-duration' : keys[0] === 'chunk_target_words' ? 'chunk-words' : keys[0]}`;
      await run(key, async () => {
        await api('/admin/pipeline-settings', {
          method: 'POST',
          body: JSON.stringify(patch),
        });
        toast('Setting saved');
        refreshAll();
      });
    },
    [run, toast, refreshAll],
  );

  // --------------------------------------------------------------- keyboard
  const gRef = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      if (typing) return;

      if (event.key === 'g') {
        gRef.current = true;
        window.setTimeout(() => {
          gRef.current = false;
        }, 700);
        return;
      }
      if (gRef.current) {
        const map: Record<string, ViewKey> = {
          o: 'overview',
          a: 'attention',
          e: 'episodes',
          j: 'jobs',
          p: 'podcasts',
          c: 'content',
          s: 'settings',
        };
        const next = map[event.key.toLowerCase()];
        if (next) {
          event.preventDefault();
          setView(next);
          gRef.current = false;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commandItems: CommandItem[] = [
    { id: 'nav-overview', label: 'Go to Overview', group: 'Navigate', hint: 'g o', run: () => setView('overview') },
    { id: 'nav-attention', label: 'Go to Attention', group: 'Navigate', hint: 'g a', run: () => setView('attention') },
    { id: 'nav-episodes', label: 'Go to Episodes', group: 'Navigate', hint: 'g e', run: () => setView('episodes') },
    { id: 'nav-jobs', label: 'Go to Jobs', group: 'Navigate', hint: 'g j', run: () => setView('jobs') },
    { id: 'nav-podcasts', label: 'Go to Podcasts', group: 'Navigate', hint: 'g p', run: () => setView('podcasts') },
    { id: 'nav-content', label: 'Go to Content', group: 'Navigate', hint: 'g c', run: () => setView('content') },
    { id: 'nav-settings', label: 'Go to Settings', group: 'Navigate', hint: 'g s', run: () => setView('settings') },
    {
      id: 'discover-queue',
      label: 'Run discovery and queue new episodes',
      group: 'Actions',
      run: () => void discover({ auto_queue: true }),
    },
    {
      id: 'discover-review',
      label: 'Run discovery without queuing',
      group: 'Actions',
      run: () => void discover({ auto_queue: false }),
    },
    {
      id: 'refresh',
      label: 'Refresh everything now',
      group: 'Actions',
      run: () => refreshAll(),
    },
    {
      id: 'pause',
      label: overview?.scheduler.processing_paused ? 'Resume processing' : 'Pause processing',
      group: 'Actions',
      run: () => void schedulerAction(overview?.scheduler.processing_paused ? 'resume' : 'pause'),
    },
  ];

  const apiContext = useMemo<AdminApi>(
    () => ({
      toast,
      confirm: setConfirmRequest,
      isPending,
      run,
      navigate,
      refreshAll,
      episodeAction,
      bulkEpisodeAction,
      jobAction,
      schedulerAction,
      discover,
      saveSettings,
    }),
    [
      toast,
      isPending,
      run,
      navigate,
      refreshAll,
      episodeAction,
      bulkEpisodeAction,
      jobAction,
      schedulerAction,
      discover,
      saveSettings,
    ],
  );

  const meta = VIEW_META[view];
  const attention = overview?.counts.attention ?? 0;
  const activeJobs = overview?.jobs.active_total ?? jobsPage?.active_total ?? 0;
  const blurbOnline = overview?.blurb.connected ?? false;
  const blurbWorkers = overview?.blurb.workers ?? [];
  const primaryWorker = blurbWorkers.find((worker) => worker.online) ?? blurbWorkers[0];
  const liveLabel =
    live.liveState === 'live' ? 'live' : live.liveState === 'connecting' ? 'connecting' : 'reconnecting';

  return (
    <AdminContext.Provider value={apiContext}>
      <div className="ac-root">
        <aside className="ac-sidebar">
          <div className="ac-brand">
            <div className="ac-brand-mark">p</div>
            <div className="ac-brand-text">
              <strong>palpal</strong>
              <span>control room</span>
            </div>
          </div>

          <nav className="ac-nav">
            <div className="ac-nav-section">Monitor</div>
            <NavItem icon={<LayoutDashboard size={15} />} label="Overview" active={view === 'overview'} onClick={() => setView('overview')} />
            <NavItem
              icon={<AlertTriangle size={15} />}
              label="Attention"
              active={view === 'attention'}
              badge={attention > 0 ? attention : undefined}
              onClick={() => setView('attention')}
            />
            <NavItem
              icon={<Mic2 size={15} />}
              label="Episodes"
              active={view === 'episodes'}
              count={attention > 0 ? undefined : overview?.counts.total}
              badge={attention > 0 ? attention : undefined}
              onClick={() => setView('episodes')}
            />
            <NavItem
              icon={<ListChecks size={15} />}
              label="Jobs"
              active={view === 'jobs'}
              count={activeJobs || undefined}
              onClick={() => setView('jobs')}
            />
            <div className="ac-nav-section">Manage</div>
            <NavItem icon={<Activity size={15} />} label="Podcasts" active={view === 'podcasts'} onClick={() => setView('podcasts')} />
            <NavItem icon={<Megaphone size={15} />} label="Content" active={view === 'content'} onClick={() => setView('content')} />
            <div className="ac-nav-section">System</div>
            <NavItem icon={<SlidersHorizontal size={15} />} label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
          </nav>

          <div className="ac-sidebar-footer">
            <div className="ac-worker-pill">
              <span className={`ac-dot ${blurbOnline ? 'online' : 'offline'}`} />
              <span>{primaryWorker ? `blurb ${primaryWorker.worker_id.slice(0, 6)}` : 'no blurb worker'}</span>
            </div>
            {primaryWorker ? (
              <div className="ac-tiny ac-subtle ac-truncate" title={primaryWorker.detail ?? ''}>
                {primaryWorker.online ? primaryWorker.stage || primaryWorker.state || 'idle' : 'offline'}
                {' · '}
                {primaryWorker.online ? 'connected' : 'stale'}
              </div>
            ) : null}
            <div className={`ac-live-row ${live.liveState}`}>
              <span className={`ac-dot ${live.liveState === 'live' ? 'online' : live.liveState === 'reconnecting' ? 'warn' : ''}`} />
              {liveLabel}
            </div>
            <a href="/admin/logout" className="ac-nav-item" style={{ padding: '7px 10px' }}>
              <LogOut size={14} /> Log out
            </a>
          </div>
        </aside>

        <main className="ac-main">
          <header className="ac-topbar">
            <div className="ac-topbar-title">
              <h1>{meta.title}</h1>
              <p>{meta.subtitle}</p>
            </div>
            <div className="ac-topbar-actions">
              <button className="ac-btn ac-btn-secondary ac-btn-sm" onClick={() => setCommandOpen(true)}>
                <Command size={13} />
                <span className="ac-small">Jump</span>
                <KeyHint>⌘K</KeyHint>
              </button>
              <Button
                size="sm"
                variant="ghost"
                icon={overviewLoading ? <Spinner /> : <RefreshCw size={13} />}
                onClick={refreshAll}
              >
                Refresh
              </Button>
            </div>
          </header>

          <div className="ac-statusbar">
            <button
              type="button"
              className={`ac-status-pill ${overview?.scheduler.processing_paused ? 'is-warn' : 'is-ok'}`}
              onClick={() =>
                void schedulerAction(overview?.scheduler.processing_paused ? 'resume' : 'pause')
              }
              disabled={!overview || isPending('scheduler')}
              title={overview?.scheduler.processing_paused ? 'Click to resume processing' : 'Click to pause processing'}
            >
              {overview?.scheduler.processing_paused ? <Pause size={12} /> : <Play size={12} />}
              {overview?.scheduler.processing_paused ? 'Processing paused' : 'Processing running'}
            </button>
            <button
              type="button"
              className={`ac-status-pill ${blurbOnline ? 'is-ok' : 'is-bad'}`}
              onClick={() => setView('overview')}
            >
              <Bot size={12} />
              {blurbOnline
                ? `Blurb online${primaryWorker?.stage ? ` · ${primaryWorker.stage}` : ''}`
                : 'Blurb offline'}
            </button>
            <button type="button" className="ac-status-pill" onClick={() => setView('jobs')}>
              <ListChecks size={12} />
              {activeJobs} active {activeJobs === 1 ? 'job' : 'jobs'}
            </button>
            <button
              type="button"
              className={`ac-status-pill ${attention > 0 ? 'is-bad' : ''}`}
              onClick={() => setView('attention')}
            >
              <AlertTriangle size={12} />
              {attention > 0 ? `${attention} need attention` : 'No episode failures'}
            </button>
            <div className="ac-statusbar-end">
              <span className={`ac-live-row ${live.liveState}`}>
                <span
                  className={`ac-dot ${live.liveState === 'live' ? 'online' : live.liveState === 'reconnecting' ? 'warn' : ''}`}
                />
                {liveLabel}
              </span>
              <span className="ac-tiny ac-subtle">
                {live.lastEventAt
                  ? `updated ${fmtRelative(new Date(live.lastEventAt).toISOString())}`
                  : overview?.generated_at
                    ? `updated ${fmtRelative(overview.generated_at)}`
                    : 'waiting for updates'}
              </span>
            </div>
          </div>

          <div className="ac-content">
            {view === 'overview' ? (
              <OverviewView
                overview={overview}
                loading={overviewLoading}
                onOpenJobs={() => setView('jobs')}
                onOpenJob={setDrawerJobId}
              />
            ) : null}

            {view === 'attention' ? (
              <AttentionView
                data={attentionData}
                loading={attentionLoading}
                includeIgnored={showIgnoredAttention}
                onToggleIgnored={setShowIgnoredAttention}
                onOpenEpisode={(episode) => openEpisode(episode.id)}
                onOpenEpisodes={() => setView('episodes')}
              />
            ) : null}

            {view === 'episodes' ? (
              <EpisodesView
                data={episodePage}
                filters={episodeFilters}
                podcasts={podcasts ?? []}
                loading={episodesLoading}
                selected={selectedEpisodes}
                onPatchFilters={patchEpisodeFilters}
                onToggleSelect={toggleSelect}
                onClearSelection={clearSelection}
                onOpenEpisode={openEpisode}
              />
            ) : null}

            {view === 'jobs' ? (
              <JobsView
                active={jobsPage}
                history={jobHistory}
                historyFilters={historyFilters}
                onPatchHistoryFilters={patchHistoryFilters}
                loadingActive={jobsLoading}
                loadingHistory={historyLoading}
                onOpenEpisode={openEpisode}
                onOpenJob={setDrawerJobId}
                onOpenEpisodePage={() => setView('episodes')}
                onActivePage={(delta) => setActiveJobsPage((previous) => Math.max(1, previous + delta))}
              />
            ) : null}

            {view === 'podcasts' ? (
              <PodcastsView
                podcasts={podcasts}
                selectedId={selectedPodcastId}
                onSelect={setSelectedPodcastId}
                loading={podcastsLoading}
                onOpenEpisodes={(podcastId, status) =>
                  navigate('episodes', {
                    episodeFilters: { podcastId, status, site: 'all', q: '', page: 1 },
                  })
                }
                onOpenJob={setDrawerJobId}
              />
            ) : null}

            {view === 'content' ? (
              <ContentView entries={updates} placeholders={placeholders} loading={contentLoading} />
            ) : null}

            {view === 'settings' ? <SettingsView overview={overview} loading={overviewLoading} /> : null}

            <div className="ac-shortcuts-hint">
              <span><KeyHint>⌘K</KeyHint> jump</span>
              <span><KeyHint>g</KeyHint> then <KeyHint>o</KeyHint><KeyHint>a</KeyHint><KeyHint>e</KeyHint><KeyHint>j</KeyHint><KeyHint>p</KeyHint><KeyHint>c</KeyHint><KeyHint>s</KeyHint></span>
              <span className="ac-subtle">Filters and the current page are kept in the URL</span>
            </div>
          </div>
        </main>

        <EpisodeDrawer
          episodeId={drawerEpisodeId}
          seed={drawerSeed}
          refreshKey={live.bumps.episodes}
          onClose={() => {
            setDrawerEpisodeId(null);
            setDrawerSeed(null);
          }}
          onOpenJob={(jobId) => {
            setDrawerEpisodeId(null);
            setDrawerSeed(null);
            setDrawerJobId(jobId);
          }}
        />

        <JobDrawer
          jobId={drawerJobId}
          refreshKey={live.bumps.jobs}
          onClose={() => setDrawerJobId(null)}
          onOpenEpisode={(episodeId) => {
            setDrawerJobId(null);
            openEpisode(episodeId);
          }}
        />

        <CommandPalette open={commandOpen} items={commandItems} onClose={() => setCommandOpen(false)} />
        <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
        <ToastViewport toasts={toasts} dismiss={dismissToast} />
      </div>
    </AdminContext.Provider>
  );
}

function NavItem({
  icon,
  label,
  active,
  count,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  count?: number;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button className={`ac-nav-item ${active ? 'is-active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {badge ? <span className="ac-nav-badge">{badge > 99 ? '99+' : badge}</span> : null}
      {!badge && count ? <span className="ac-nav-count">{count.toLocaleString()}</span> : null}
    </button>
  );
}
