'use client';

import React, { useEffect, useState } from 'react';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Eye,
  ListChecks,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { Job, JobHistoryFilters, JobHistoryPage, JobsPage } from './types';
import {
  Badge,
  Button,
  EmptyState,
  ProgressBar,
  Spinner,
  fmtNumber,
  fmtRelative,
  jobLabel,
  titleCase,
} from './ui';

type Tab = 'active' | 'history';

function stageOf(job: Job): string {
  const stage = job.progress?.stage;
  if (stage) return titleCase(stage);
  if (job.status === 'pending') return 'Queued';
  if (job.status === 'claimed') return 'Claimed';
  return titleCase(job.status);
}

function JobRow({
  job,
  mode,
  onOpenEpisode,
  onOpenJob,
}: {
  job: Job;
  mode: 'active' | 'history';
  onOpenEpisode: (episodeId: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const admin = useAdmin();
  const target = jobLabel(job);
  const percent = job.progress?.percent;

  return (
    <tr className="is-clickable" onClick={() => onOpenJob(job.id)}>
      <td>
        <Badge tone={job.kind === 'process' ? 'blue' : 'purple'}>{job.kind}</Badge>
      </td>
      <td>
        <div className="ac-row-title" style={{ fontWeight: 500 }}>
          {target.primary}
        </div>
        <div className="ac-row-sub">
          {target.secondary || '—'}
          {job.error ? (
            <span className="ac-danger-text"> · {job.error_type ? `${job.error_type}: ` : ''}{job.error}</span>
          ) : null}
        </div>
        {mode === 'active' && job.status === 'claimed' ? (
          <div style={{ maxWidth: 340, marginTop: 5 }}>
            <ProgressBar percent={percent} height={4} />
          </div>
        ) : null}
      </td>
      <td>
        <Badge>{job.status}</Badge>
      </td>
      <td className="ac-cell-muted">
        <div>{stageOf(job)}</div>
        {job.claimed_by_worker ? <div className="ac-mono ac-tiny">{job.claimed_by_worker.slice(0, 8)}</div> : null}
      </td>
      <td className="ac-cell-muted">{job.attempts ?? 0}</td>
      <td className="ac-cell-muted ac-nowrap">
        {mode === 'active'
          ? fmtRelative(job.claimed_at || job.created_at)
          : fmtRelative(job.finished_at || job.created_at)}
      </td>
      <td className="is-actions" onClick={(e) => e.stopPropagation()}>
        <div className="ac-row-actions">
          {job.episode_id ? (
            <button
              className="ac-icon-btn"
              title="Open episode"
              onClick={() => onOpenEpisode(job.episode_id as string)}
            >
              <Eye size={13} />
            </button>
          ) : null}
          {mode === 'active' && job.status === 'pending' ? (
            <button
              className="ac-icon-btn"
              title="Move to front"
              onClick={() => admin.jobAction('prioritize', job.id)}
            >
              <Sparkles size={13} />
            </button>
          ) : null}
          {mode === 'active' ? (
            <button
              className="ac-icon-btn is-danger"
              title="Cancel job"
              onClick={() =>
                admin.confirm({
                  title: 'Cancel job?',
                  message: (
                    <>
                      Cancel the <strong>{job.kind}</strong> job for <strong>{target.primary}</strong>?
                      A result already in flight from blurb will be discarded.
                    </>
                  ),
                  confirmLabel: 'Cancel job',
                  tone: 'danger',
                  onConfirm: () => admin.jobAction('cancel', job.id),
                })
              }
            >
              <Ban size={13} />
            </button>
          ) : (
            <button
              className="ac-icon-btn"
              title="Retry job"
              onClick={() => admin.jobAction('retry', job.id)}
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function JobsView({
  active,
  history,
  historyFilters,
  onPatchHistoryFilters,
  loadingActive,
  loadingHistory,
  onOpenEpisode,
  onOpenJob,
  onOpenEpisodePage,
  onActivePage,
}: {
  active: JobsPage | null;
  history: JobHistoryPage | null;
  historyFilters: JobHistoryFilters;
  onPatchHistoryFilters: (patch: Partial<JobHistoryFilters>) => void;
  loadingActive: boolean;
  loadingHistory: boolean;
  onOpenEpisode: (episodeId: string) => void;
  onOpenJob: (jobId: string) => void;
  onOpenEpisodePage: () => void;
  onActivePage: (delta: number) => void;
}) {
  const admin = useAdmin();
  const [tab, setTab] = useState<Tab>('active');
  const [qInput, setQInput] = useState(historyFilters.q);

  useEffect(() => {
    setQInput(historyFilters.q);
  }, [historyFilters.q]);

  useEffect(() => {
    if (qInput === historyFilters.q) return;
    const timer = window.setTimeout(() => onPatchHistoryFilters({ q: qInput, page: 1 }), 280);
    return () => window.clearTimeout(timer);
  }, [qInput, historyFilters.q, onPatchHistoryFilters]);

  const activeCount = active?.active_total ?? 0;
  const activePage = active?.page ?? 1;
  const activePageSize = active?.page_size ?? 100;
  const activeTotalPages = Math.max(1, Math.ceil(activeCount / activePageSize));
  const activeFrom = activeCount === 0 ? 0 : (activePage - 1) * activePageSize + 1;
  const activeTo = Math.min(activePage * activePageSize, activeCount);
  const historyTotal = history?.total ?? 0;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyFilters.pageSize));
  const from = historyTotal === 0 ? 0 : (historyFilters.page - 1) * historyFilters.pageSize + 1;
  const to = Math.min(historyFilters.page * historyFilters.pageSize, historyTotal);

  return (
    <div className="ac-stack">
      <div className="ac-card" style={{ paddingBottom: 12 }}>
        <div className="ac-row-between" style={{ marginBottom: 12 }}>
          <div className="ac-tabs" style={{ marginBottom: 0 }}>
            <button className={`ac-tab ${tab === 'active' ? 'is-active' : ''}`} onClick={() => setTab('active')}>
              Active <span className="ac-tab-count">{fmtNumber(activeCount)}</span>
            </button>
            <button className={`ac-tab ${tab === 'history' ? 'is-active' : ''}`} onClick={() => setTab('history')}>
              History <span className="ac-tab-count">{fmtNumber(historyTotal)}</span>
            </button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={12} />}
            onClick={() =>
              admin.confirm({
                title: 'Clear finished job history?',
                message:
                  'This deletes every completed and failed job row. It does not touch episodes, transcripts, or the active queue.',
                confirmLabel: 'Clear history',
                tone: 'danger',
                requireText: 'CLEAR',
                onConfirm: async () => {
                  await admin.run('purge-jobs', async () => {
                    const result = await api<{ deleted: number }>('/admin/jobs/purge', {
                      method: 'POST',
                      body: JSON.stringify({}),
                    });
                    admin.toast(`Deleted ${result.deleted} job(s) from history`);
                    admin.refreshAll();
                  });
                },
              })
            }
          >
            Clear finished
          </Button>
        </div>

        {tab === 'active' ? (
          <>
            <div className="ac-row ac-tiny ac-subtle" style={{ marginBottom: 10 }}>
              <ListChecks size={13} />
              {active?.counts && Object.keys(active.counts).length > 0
                ? Object.entries(active.counts)
                    .map(([key, value]) => `${key.replace('_', ' ')} ${value}`)
                    .join(' · ')
                : 'No active jobs'}
              {loadingActive ? <Spinner /> : null}
            </div>

            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>kind</th>
                    <th>target</th>
                    <th>status</th>
                    <th>stage / worker</th>
                    <th>attempts</th>
                    <th>age</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {active?.active.length ? (
                    active.active.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        mode="active"
                        onOpenEpisode={onOpenEpisode}
                        onOpenJob={onOpenJob}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          title="Queue is empty"
                          detail="Pending and claimed jobs appear here the moment they are created."
                          action={
                            <Button variant="secondary" size="sm" onClick={onOpenEpisodePage}>
                              Browse episodes
                            </Button>
                          }
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {activeCount > activePageSize ? (
              <div className="ac-pagination">
                <span>
                  {fmtNumber(activeFrom)}–{fmtNumber(activeTo)} of {fmtNumber(activeCount)}
                </span>
                <div className="ac-row">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={activePage <= 1}
                    icon={<ChevronLeft size={13} />}
                    onClick={() => onActivePage(-1)}
                  >
                    Prev
                  </Button>
                  <span className="ac-tiny">
                    page {activePage} / {activeTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={activePage >= activeTotalPages}
                    icon={<ChevronRight size={13} />}
                    onClick={() => onActivePage(1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="ac-toolbar">
              <div className="ac-search">
                <Search size={14} />
                <input
                  className="ac-input"
                  placeholder="Match title, source, or error…"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                />
              </div>
              <select
                className="ac-select"
                value={historyFilters.status}
                onChange={(e) => onPatchHistoryFilters({ status: e.target.value, page: 1 })}
              >
                <option value="all">All outcomes</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
              <select
                className="ac-select"
                value={historyFilters.kind}
                onChange={(e) => onPatchHistoryFilters({ kind: e.target.value, page: 1 })}
              >
                <option value="all">All kinds</option>
                <option value="process">Process</option>
                <option value="discover">Discover</option>
              </select>
              <div className="ac-row-end ac-tiny ac-subtle">
                {loadingHistory ? <Spinner /> : null}
                {history?.counts ? (
                  <>
                    {fmtNumber(history.counts.completed ?? 0)} completed · {fmtNumber(history.counts.failed ?? 0)} failed
                  </>
                ) : null}
              </div>
            </div>

            {historyFilters.status !== 'all' || historyFilters.kind !== 'all' || historyFilters.q ? (
              <div className="ac-chips">
                <span className="ac-chips-label">Filters</span>
                {historyFilters.status !== 'all' ? (
                  <button
                    type="button"
                    className="ac-chip"
                    onClick={() => onPatchHistoryFilters({ status: 'all', page: 1 })}
                  >
                    {historyFilters.status}
                    <X size={11} />
                  </button>
                ) : null}
                {historyFilters.kind !== 'all' ? (
                  <button
                    type="button"
                    className="ac-chip"
                    onClick={() => onPatchHistoryFilters({ kind: 'all', page: 1 })}
                  >
                    {historyFilters.kind}
                    <X size={11} />
                  </button>
                ) : null}
                {historyFilters.q ? (
                  <button
                    type="button"
                    className="ac-chip"
                    onClick={() => onPatchHistoryFilters({ q: '', page: 1 })}
                  >
                    “{historyFilters.q}”
                    <X size={11} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ac-chip ac-chip-clear"
                  onClick={() => onPatchHistoryFilters({ status: 'all', kind: 'all', q: '', page: 1 })}
                >
                  Clear all
                </button>
              </div>
            ) : null}

            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>kind</th>
                    <th>target / error</th>
                    <th>status</th>
                    <th>stage / worker</th>
                    <th>attempts</th>
                    <th>finished</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history?.jobs.length ? (
                    history.jobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        mode="history"
                        onOpenEpisode={onOpenEpisode}
                        onOpenJob={onOpenJob}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState title="No matching history" detail="Completed and failed jobs appear here after they finish." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="ac-pagination">
              <span>
                {fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(historyTotal)}
              </span>
              <div className="ac-row">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={historyFilters.page <= 1}
                  icon={<ChevronLeft size={13} />}
                  onClick={() => onPatchHistoryFilters({ page: historyFilters.page - 1 })}
                >
                  Prev
                </Button>
                <span className="ac-tiny">
                  page {historyFilters.page} / {historyTotalPages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={historyFilters.page >= historyTotalPages}
                  icon={<ChevronRight size={13} />}
                  onClick={() => onPatchHistoryFilters({ page: historyFilters.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
