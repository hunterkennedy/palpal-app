'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  HelpCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { qs } from './api';
import type { Episode, EpisodeFilters, EpisodePage, Podcast } from './types';
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  ProgressBar,
  Spinner,
  fmtDuration,
  fmtNumber,
  titleCase,
  episodeUrl,
} from './ui';

const STATUS_COLORS: Record<string, string> = {
  all: 'var(--ac-muted)',
  attention: 'var(--ac-red)',
  discovered: 'var(--ac-blue)',
  downloading: 'var(--ac-yellow)',
  processed: 'var(--ac-green)',
  failed: 'var(--ac-red)',
  orphaned: '#94a3b8',
  blacklisted: 'var(--ac-accent)',
};

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Attention' },
  { key: 'discovered', label: 'Discovered' },
  { key: 'downloading', label: 'In flight' },
  { key: 'processed', label: 'Processed' },
  { key: 'failed', label: 'Failed' },
  { key: 'orphaned', label: 'Orphaned' },
  { key: 'blacklisted', label: 'Blacklisted' },
];

interface SavedView {
  id: string;
  name: string;
  filters: Partial<EpisodeFilters>;
}

const SAVED_VIEWS_KEY = 'palpal_admin_saved_views';

function siteBadge(site: string) {
  if (site === 'patreon') return <Badge tone="orange">patreon</Badge>;
  if (site === 'rss') return <Badge tone="purple">rss</Badge>;
  return <Badge tone="red">yt</Badge>;
}

function stageFor(episode: Episode): { label: string; percent?: number } | null {
  const job = episode.active_job;
  if (!job) return null;
  const progress = job.progress ?? {};
  const stage = progress.stage || (job.status === 'pending' ? 'queued' : 'working');
  return {
    label: stage === 'downloading' ? 'Downloading' : titleCase(stage),
    percent: progress.percent,
  };
}

export default function EpisodesView({
  data,
  filters,
  podcasts,
  loading,
  selected,
  onPatchFilters,
  onToggleSelect,
  onClearSelection,
  onOpenEpisode,
}: {
  data: EpisodePage | null;
  filters: EpisodeFilters;
  podcasts: Podcast[];
  loading: boolean;
  selected: Set<string>;
  onPatchFilters: (patch: Partial<EpisodeFilters>) => void;
  onToggleSelect: (id: string, checked: boolean) => void;
  onClearSelection: () => void;
  onOpenEpisode: (episode: Episode) => void;
}) {
  const admin = useAdmin();
  const [qInput, setQInput] = useState(filters.q);
  const [allMatching, setAllMatching] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [activeRow, setActiveRow] = useState(0);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => new Set(['podcast', 'status', 'published', 'length']),
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
      if (raw) setSavedViews(JSON.parse(raw) as SavedView[]);
      const display = window.localStorage.getItem('palpal_admin_episode_display');
      if (display) {
        const parsed = JSON.parse(display) as { density?: string; columns?: string[] };
        if (parsed.density === 'compact' || parsed.density === 'comfortable') {
          setDensity(parsed.density);
        }
        if (Array.isArray(parsed.columns)) setVisibleColumns(new Set(parsed.columns));
      }
    } catch {
      // ignore malformed local state
    }
  }, []);

  const updateDisplay = (nextDensity: 'comfortable' | 'compact', nextColumns: Set<string>) => {
    setDensity(nextDensity);
    setVisibleColumns(nextColumns);
    try {
      window.localStorage.setItem(
        'palpal_admin_episode_display',
        JSON.stringify({ density: nextDensity, columns: [...nextColumns] }),
      );
    } catch {
      // ignore
    }
  };

  const persistViews = (next: SavedView[]) => {
    setSavedViews(next);
    try {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    } catch {
      // storage can be unavailable; feature simply won't persist
    }
  };

  const saveCurrentView = () => {
    const name = viewName.trim();
    if (!name) return;
    const view: SavedView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      filters: {
        status: filters.status,
        q: filters.q,
        podcastId: filters.podcastId,
        site: filters.site,
        sort: filters.sort,
      },
    };
    persistViews([...savedViews.filter((v) => v.name !== name), view]);
    setViewName('');
  };

  useEffect(() => {
    setQInput(filters.q);
  }, [filters.q]);

  useEffect(() => {
    setAllMatching(false);
    onClearSelection();
    // Filters intentionally reset cross-page selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.podcastId, filters.site, filters.q]);

  useEffect(() => {
    if (qInput === filters.q) return;
    const timer = window.setTimeout(() => onPatchFilters({ q: qInput, page: 1 }), 280);
    return () => window.clearTimeout(timer);
  }, [qInput, filters.q, onPatchFilters]);

  const episodes = useMemo(() => data?.episodes ?? [], [data?.episodes]);
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const page = filters.page;
  const pageSize = filters.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const allOnPageSelected = episodes.length > 0 && episodes.every((ep) => selected.has(ep.id));
  const someOnPageSelected = episodes.some((ep) => selected.has(ep.id));
  const effectiveSelected = allMatching ? total : selected.size;
  const columnCount = 3 + visibleColumns.size;

  const runBulk = (action: string) => {
    const ids = allMatching ? [] : [...selected];
    const filter = allMatching ? filters : undefined;
    const execute = async () => {
      await admin.bulkEpisodeAction(action, ids, { allMatching, filter });
      setAllMatching(false);
      onClearSelection();
    };

    if (action === 'delete') {
      admin.confirm({
        title: `Delete ${fmtNumber(effectiveSelected)} episode${effectiveSelected === 1 ? '' : 's'}?`,
        message: (
          <>
            This deletes the episode row, search chunks, and the stored transcript in B2. It cannot
            be undone.
            {allMatching ? (
              <>
                {' '}
                The server will resolve the current filters and delete <strong>{fmtNumber(total)}</strong>{' '}
                matching episodes.
              </>
            ) : null}
          </>
        ),
        confirmLabel: 'Delete permanently',
        tone: 'danger',
        requireText: 'DELETE',
        onConfirm: execute,
      });
    } else if (action === 'blacklist') {
      admin.confirm({
        title: `Blacklist ${fmtNumber(effectiveSelected)} episode${effectiveSelected === 1 ? '' : 's'}?`,
        message: 'Blacklisted episodes stay in the database to prevent re-discovery, but are skipped by the pipeline.',
        confirmLabel: 'Blacklist',
        tone: 'danger',
        onConfirm: execute,
      });
    } else {
      void execute();
    }
  };

  useEffect(() => {
    setActiveRow(0);
  }, [filters.page, filters.status, filters.podcastId, filters.site, filters.q]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('.ac-drawer, .ac-modal-overlay, .ac-command-overlay')) return;

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!episodes.length) return;
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveRow((prev) => Math.min(episodes.length - 1, prev + 1));
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveRow((prev) => Math.max(0, prev - 1));
      } else if (event.key === 'x' || event.key === ' ') {
        event.preventDefault();
        const episode = episodes[activeRow];
        if (!episode) return;
        if (allMatching) {
          setAllMatching(false);
          onClearSelection();
          onToggleSelect(episode.id, true);
        } else {
          onToggleSelect(episode.id, !selected.has(episode.id));
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const episode = episodes[activeRow];
        if (episode) onOpenEpisode(episode);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    episodes,
    activeRow,
    allMatching,
    selected,
    onClearSelection,
    onToggleSelect,
    onOpenEpisode,
  ]);

  useEffect(() => {
    const row = document.querySelector(`#ep-tbody tr[data-row-index="${activeRow}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeRow, episodes.length]);

  return (
    <div className="ac-stack">
      <div className="ac-card" style={{ paddingBottom: 12 }}>
        <div className="ac-tabs">
          {STATUS_TABS.map((tab) => {
            const count = counts[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                className={`ac-tab ${filters.status === tab.key ? 'is-active' : ''}`}
                onClick={() => onPatchFilters({ status: tab.key, page: 1 })}
              >
                <span
                  className="ac-tab-dot"
                  style={{ background: STATUS_COLORS[tab.key] ?? 'var(--ac-muted)' }}
                />
                {tab.label}
                <span className="ac-tab-count">{fmtNumber(count)}</span>
              </button>
            );
          })}
        </div>

        <div className="ac-toolbar">
          <div className="ac-search">
            <Search size={14} />
            <input
              ref={searchRef}
              className="ac-input"
              placeholder="Filter by title, podcast, or source…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>

          <select
            className="ac-select"
            value={filters.podcastId}
            onChange={(e) => onPatchFilters({ podcastId: e.target.value, page: 1 })}
          >
            <option value="all">All podcasts</option>
            {podcasts.map((pod) => (
              <option key={pod.id} value={pod.id}>
                {pod.display_name}
              </option>
            ))}
          </select>

          <select
            className="ac-select"
            value={filters.site}
            onChange={(e) => onPatchFilters({ site: e.target.value, page: 1 })}
          >
            <option value="all">All sources</option>
            <option value="youtube">YouTube</option>
            <option value="patreon">Patreon</option>
            <option value="rss">RSS</option>
          </select>

          <select
            className="ac-select"
            value={filters.sort}
            onChange={(e) => onPatchFilters({ sort: e.target.value, page: 1 })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="updated">Recently updated</option>
            <option value="status">Status</option>
            <option value="title">Title</option>
            <option value="duration">Duration</option>
          </select>

          <div className="ac-menu-wrap">
            <Button
              size="sm"
              variant={viewsOpen ? 'secondary' : 'ghost'}
              icon={<Bookmark size={12} />}
              onClick={() => setViewsOpen((open) => !open)}
            >
              Views
            </Button>
            {viewsOpen ? (
              <div className="ac-menu-panel" style={{ right: 0, left: 'auto', width: 280 }}>
                <div className="ac-menu-heading">Saved views</div>
                {savedViews.length === 0 ? (
                  <div className="ac-menu-empty">No saved views yet.</div>
                ) : (
                  savedViews.map((view) => (
                    <div className="ac-menu-row" key={view.id}>
                      <button
                        type="button"
                        className="ac-menu-item"
                        onClick={() => {
                          onPatchFilters({ ...view.filters, page: 1 });
                          setViewsOpen(false);
                        }}
                      >
                        <span className="ac-truncate">{view.name}</span>
                        <span className="ac-tiny ac-subtle">
                          {view.filters.status ?? 'all'}
                          {view.filters.podcastId && view.filters.podcastId !== 'all' ? ' · filtered' : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ac-icon-btn is-danger"
                        title="Delete view"
                        onClick={() => persistViews(savedViews.filter((v) => v.id !== view.id))}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
                <div className="ac-menu-divider" />
                <div className="ac-row" style={{ gap: 5 }}>
                  <input
                    className="ac-input is-small"
                    placeholder="Name current view…"
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCurrentView();
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!viewName.trim()}
                    onClick={saveCurrentView}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="ac-menu-wrap">
            <Button
              size="sm"
              variant={displayOpen ? 'secondary' : 'ghost'}
              icon={<SlidersHorizontal size={12} />}
              onClick={() => setDisplayOpen((open) => !open)}
            >
              Display
            </Button>
            {displayOpen ? (
              <div className="ac-menu-panel" style={{ right: 0, left: 'auto', width: 230 }}>
                <div className="ac-menu-heading">Density</div>
                <div className="ac-row" style={{ padding: '0 5px 6px' }}>
                  <Button
                    size="sm"
                    variant={density === 'comfortable' ? 'primary' : 'ghost'}
                    onClick={() => updateDisplay('comfortable', visibleColumns)}
                  >
                    Comfortable
                  </Button>
                  <Button
                    size="sm"
                    variant={density === 'compact' ? 'primary' : 'ghost'}
                    onClick={() => updateDisplay('compact', visibleColumns)}
                  >
                    Compact
                  </Button>
                </div>
                <div className="ac-menu-divider" />
                <div className="ac-menu-heading">Columns</div>
                {[
                  ['podcast', 'Podcast'],
                  ['status', 'Status'],
                  ['published', 'Published'],
                  ['length', 'Length'],
                ].map(([key, label]) => (
                  <label className="ac-menu-check" key={key}>
                    <input
                      type="checkbox"
                      className="ac-check"
                      checked={visibleColumns.has(key)}
                      onChange={(e) => {
                        const next = new Set(visibleColumns);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        updateDisplay(density, next);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <Button
            size="sm"
            variant="ghost"
            icon={<HelpCircle size={12} />}
            onClick={() => setGlossaryOpen(true)}
            title="What the episode statuses mean"
          />

          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={12} />}
            onClick={() =>
              window.open(
                `/api/admin/episodes/export${qs({
                  status: filters.status,
                  podcast_id: filters.podcastId,
                  site: filters.site,
                  q: filters.q,
                  sort: filters.sort,
                })}`,
                '_blank',
              )
            }
          >
            CSV
          </Button>

          <div className="ac-row-end ac-tiny ac-subtle">
            {loading ? <Spinner /> : null}
            {fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(total)}
          </div>
        </div>

        {filters.status !== 'all' || filters.podcastId !== 'all' || filters.site !== 'all' || filters.q ? (
          <div className="ac-chips">
            <span className="ac-chips-label">Filters</span>
            {filters.status !== 'all' ? (
              <button
                type="button"
                className="ac-chip"
                onClick={() => onPatchFilters({ status: 'all', page: 1 })}
              >
                <span className="ac-chip-dot" style={{ background: STATUS_COLORS[filters.status] }} />
                {STATUS_TABS.find((tab) => tab.key === filters.status)?.label ?? filters.status}
                <X size={11} />
              </button>
            ) : null}
            {filters.podcastId !== 'all' ? (
              <button
                type="button"
                className="ac-chip"
                onClick={() => onPatchFilters({ podcastId: 'all', page: 1 })}
              >
                {podcasts.find((pod) => pod.id === filters.podcastId)?.display_name ?? filters.podcastId}
                <X size={11} />
              </button>
            ) : null}
            {filters.site !== 'all' ? (
              <button
                type="button"
                className="ac-chip"
                onClick={() => onPatchFilters({ site: 'all', page: 1 })}
              >
                {filters.site === 'youtube' ? 'YouTube' : filters.site === 'patreon' ? 'Patreon' : 'RSS'}
                <X size={11} />
              </button>
            ) : null}
            {filters.q ? (
              <button type="button" className="ac-chip" onClick={() => onPatchFilters({ q: '', page: 1 })}>
                “{filters.q}”
                <X size={11} />
              </button>
            ) : null}
            <button
              type="button"
              className="ac-chip ac-chip-clear"
              onClick={() =>
                onPatchFilters({ status: 'all', podcastId: 'all', site: 'all', q: '', page: 1 })
              }
            >
              Clear all
            </button>
          </div>
        ) : null}

        {effectiveSelected > 0 ? (
          <div
            className="ac-row"
            style={{
              padding: '8px 10px',
              border: '1px solid var(--ac-accent-border)',
              background: 'var(--ac-accent-soft)',
              borderRadius: 8,
              marginBottom: 10,
            }}
          >
            <strong style={{ color: '#ffc078', fontSize: 12 }}>
              {allMatching ? `All ${fmtNumber(total)} matching` : `${fmtNumber(selected.size)} selected`}
            </strong>

            {!allMatching && total > selected.size ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onClearSelection();
                  setAllMatching(true);
                }}
              >
                Select all {fmtNumber(total)} matching
              </Button>
            ) : null}

            <span className="ac-sep" />

            <Button size="sm" variant="warning" icon={<RotateCcw size={12} />} onClick={() => runBulk('retry')}>
              Retry
            </Button>
            <Button size="sm" variant="secondary" icon={<Play size={12} />} onClick={() => runBulk('process')}>
              Process
            </Button>
            <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={() => runBulk('retranscribe')}>
              Re-transcribe
            </Button>
            <Button size="sm" variant="secondary" icon={<Ban size={12} />} onClick={() => runBulk('blacklist')}>
              Blacklist
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => runBulk('unblacklist')}>
              Unblacklist
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => runBulk('delete')}>
              Delete
            </Button>

            <button
              className="ac-icon-btn"
              style={{ marginLeft: 'auto' }}
              title="Clear selection"
              onClick={() => {
                setAllMatching(false);
                onClearSelection();
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        <div className="ac-table-wrap">
          <table className={`ac-table ac-episodes-table ${density === 'compact' ? 'is-compact' : ''}`}>
            <thead>
              <tr>
                <th className="is-check">
                  <input
                    type="checkbox"
                    className="ac-check"
                    checked={allMatching || allOnPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allMatching && someOnPageSelected && !allOnPageSelected;
                    }}
                    onChange={(e) => {
                      if (allMatching) {
                        setAllMatching(false);
                        onClearSelection();
                        if (e.target.checked) {
                          episodes.forEach((ep) => onToggleSelect(ep.id, true));
                        }
                        return;
                      }
                      if (e.target.checked) {
                        episodes.forEach((ep) => onToggleSelect(ep.id, true));
                      } else {
                        episodes.forEach((ep) => onToggleSelect(ep.id, false));
                      }
                    }}
                  />
                </th>
                <th>episode</th>
                {visibleColumns.has('podcast') ? <th>podcast</th> : null}
                {visibleColumns.has('status') ? <th>status</th> : null}
                {visibleColumns.has('published') ? <th>published</th> : null}
                {visibleColumns.has('length') ? <th>length</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && episodes.length === 0 ? (
                <tr>
                  <td colSpan={columnCount}>
                    <div style={{ padding: 30, textAlign: 'center' }}>
                      <Spinner size={18} />
                    </div>
                  </td>
                </tr>
              ) : episodes.length === 0 ? (
                <tr>
                  <td colSpan={columnCount}>
                    <EmptyState
                      title="No episodes match"
                      detail="Try a different status, podcast, source, or search term."
                      action={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            onPatchFilters({
                              status: 'all',
                              podcastId: 'all',
                              site: 'all',
                              q: '',
                              page: 1,
                            })
                          }
                        >
                          Clear filters
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                episodes.map((ep, rowIndex) => {
                  const isSelected = allMatching || selected.has(ep.id);
                  const stage = stageFor(ep);
                  const url = episodeUrl(ep);
                  return (
                    <tr
                      key={ep.id}
                      data-row-index={rowIndex}
                      className={`${isSelected ? 'is-selected' : ''} ${ep.blacklisted ? 'is-dim' : ''} ${rowIndex === activeRow ? 'is-active-row' : ''} is-clickable`}
                      onClick={() => onOpenEpisode(ep)}
                    >
                      <td className="is-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="ac-check"
                          checked={isSelected}
                          onChange={(e) => {
                            if (allMatching) {
                              setAllMatching(false);
                              onClearSelection();
                              onToggleSelect(ep.id, e.target.checked);
                            } else {
                              onToggleSelect(ep.id, e.target.checked);
                            }
                          }}
                        />
                      </td>
                      <td>
                        {url ? (
                          <a
                            className="ac-row-title"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            title={ep.title}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ep.title || '(untitled)'}
                          </a>
                        ) : (
                          <span className="ac-row-title" title={ep.title}>
                            {ep.title || '(untitled)'}
                          </span>
                        )}
                        {ep.error_message ? (
                          <span className="ac-row-sub is-error" title={ep.error_message}>
                            {ep.error_message}
                          </span>
                        ) : stage ? (
                          <span className="ac-row-sub">
                            {stage.label}
                            {stage.percent !== undefined ? ` · ${stage.percent.toFixed(0)}%` : ''}
                            {ep.active_job?.claimed_by_worker ? ` · ${ep.active_job.claimed_by_worker.slice(0, 8)}` : ''}
                          </span>
                        ) : (
                          <span className="ac-row-sub">
                            {ep.source_name}
                            {ep.updated_at ? ` · updated ${new Date(ep.updated_at).toLocaleDateString()}` : ''}
                          </span>
                        )}
                        {stage && stage.percent !== undefined ? (
                          <div style={{ maxWidth: 360, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                            <ProgressBar percent={stage.percent} height={4} />
                          </div>
                        ) : null}
                      </td>
                      {visibleColumns.has('podcast') ? (
                        <td data-label="Podcast">
                          <button
                            type="button"
                            className="ac-linklike"
                            title={`Filter to ${ep.podcast_name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPatchFilters({ podcastId: ep.podcast_id, page: 1 });
                            }}
                          >
                            {ep.podcast_name}
                          </button>
                          <div className="ac-row" style={{ gap: 4, marginTop: 2 }}>
                            {siteBadge(ep.site)}
                          </div>
                        </td>
                      ) : null}
                      {visibleColumns.has('status') ? (
                        <td data-label="Status">
                          <Badge>{ep.status}</Badge>
                          {ep.blacklisted ? (
                            <span style={{ marginLeft: 4 }}>
                              <Badge tone="orange" title="Blacklisted">
                                ⊘
                              </Badge>
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      {visibleColumns.has('published') ? (
                        <td className="ac-cell-muted" data-label="Published">
                          {ep.publication_date ?? '—'}
                        </td>
                      ) : null}
                      {visibleColumns.has('length') ? (
                        <td className="ac-cell-muted" data-label="Length">
                          {fmtDuration(ep.duration_seconds)}
                        </td>
                      ) : null}
                      <td className="is-actions" data-label="Actions" onClick={(e) => e.stopPropagation()}>
                        <div className="ac-row-actions">
                          {ep.status === 'discovered' ? (
                            <button
                              className="ac-icon-btn"
                              title="Process now"
                              onClick={() => admin.episodeAction('process', ep.id)}
                            >
                              <Play size={13} />
                            </button>
                          ) : null}
                          {ep.status === 'failed' || ep.status === 'downloading' ? (
                            <button
                              className="ac-icon-btn"
                              title="Retry"
                              onClick={() => admin.episodeAction('retry', ep.id)}
                            >
                              <RotateCcw size={13} />
                            </button>
                          ) : null}
                          {ep.status === 'processed' ? (
                            <button
                              className="ac-icon-btn"
                              title="Re-transcribe"
                              onClick={() => admin.episodeAction('retranscribe', ep.id)}
                            >
                              <RefreshCw size={13} />
                            </button>
                          ) : null}
                          <button
                            className="ac-icon-btn"
                            title={ep.blacklisted ? 'Remove blacklist' : 'Blacklist'}
                            onClick={() => admin.episodeAction(ep.blacklisted ? 'unblacklist' : 'blacklist', ep.id)}
                          >
                            <Ban size={13} />
                          </button>
                          <button
                            className="ac-icon-btn is-danger"
                            title="Delete"
                            onClick={() =>
                              admin.confirm({
                                title: 'Delete episode?',
                                message: (
                                  <>
                                    Permanently delete <strong>{ep.title || '(untitled)'}</strong>, its
                                    search chunks, and its stored transcript. This cannot be undone.
                                  </>
                                ),
                                confirmLabel: 'Delete',
                                tone: 'danger',
                                onConfirm: async () => {
                                  await admin.episodeAction('delete', ep.id);
                                },
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                          <button className="ac-icon-btn" title="Details" onClick={() => onOpenEpisode(ep)}>
                            <Eye size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="ac-pagination">
          <span>
            {fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(total)} episodes
          </span>
          <div className="ac-row">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              icon={<ChevronLeft size={13} />}
              onClick={() => onPatchFilters({ page: page - 1 })}
            >
              Prev
            </Button>
            <span className="ac-tiny">
              page {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              icon={<ChevronRight size={13} />}
              onClick={() => onPatchFilters({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={glossaryOpen}
        onClose={() => setGlossaryOpen(false)}
        title="Episode status guide"
        subtitle="How the pipeline moves an episode from discovery to search."
        width={560}
      >
        <div className="ac-glossary">
          {[
            ['discovered', 'The source listed the episode; it has not been downloaded yet.'],
            ['downloading', 'Blurb has claimed a process job and is downloading or transcribing.'],
            ['processed', 'Transcript chunks are stored and searchable.'],
            ['failed', 'The last process attempt failed. Check the job history for the error.'],
            ['orphaned', 'The episode disappeared from the source on a later discovery run.'],
            ['blacklisted', 'Kept in the database to prevent re-discovery, but skipped by the pipeline.'],
            ['attention', 'Inbox grouping for failed + orphaned episodes, not a stored status.'],
          ].map(([status, description]) => (
            <div className="ac-glossary-row" key={status}>
              <Badge>{status}</Badge>
              <span>{description}</span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
