'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  Eye,
  FileSearch,
  Gauge,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  Timer,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { EpisodeFilters, Job, Overview } from './types';
import {
  Badge,
  Button,
  EmptyState,
  ProgressBar,
  Spinner,
  Stat,
  fmtDateTime,
  fmtEta,
  fmtNumber,
  fmtRelative,
  jobLabel,
  titleCase,
} from './ui';

function nextRun(overview: Overview, id: string): string | null {
  return overview.scheduler.jobs.find((job) => job.id === id)?.next_run ?? null;
}

function jobStage(job: Job): { label: string; percent?: number } {
  const progress = job.progress ?? {};
  const stage = progress.stage || job.status;
  return {
    label: stage === 'downloading' ? 'Downloading' : titleCase(stage),
    percent: progress.percent,
  };
}

export default function OverviewView({
  overview,
  loading,
  onOpenJobs,
  onOpenJob,
}: {
  overview: Overview | null;
  loading: boolean;
  onOpenJobs: () => void;
  onOpenJob: (jobId: string) => void;
}) {
  const admin = useAdmin();

  if (!overview) {
    return (
      <div className="ac-card" style={{ padding: 40, textAlign: 'center' }}>
        {loading ? <Spinner size={20} /> : <span className="ac-muted">Could not load overview.</span>}
      </div>
    );
  }

  const paused = overview.scheduler.processing_paused;
  const counts = overview.counts;
  const queue = overview.jobs.active_total;
  const discoveryNext = nextRun(overview, 'discovery');
  const reclaimNext = nextRun(overview, 'reclaim');

  const openEpisodes = (patch: Partial<EpisodeFilters>) =>
    admin.navigate('episodes', {
      episodeFilters: { podcastId: 'all', site: 'all', q: '', page: 1, ...patch },
    });

  return (
    <div className="ac-stack">
      <div className="ac-stats">
        <Stat
          label="episodes"
          value={fmtNumber(counts.total)}
          hint={`${fmtNumber(counts.processed)} processed`}
          onClick={() => openEpisodes({ status: 'all', page: 1 })}
        />
        <Stat
          label="in flight"
          value={fmtNumber(counts.downloading)}
          hint="downloading / transcribing"
          tone="yellow"
          onClick={() => openEpisodes({ status: 'downloading', page: 1 })}
        />
        <Stat
          label="needs attention"
          value={fmtNumber(counts.attention)}
          hint="failed + orphaned"
          tone={counts.attention > 0 ? 'red' : ''}
          onClick={() => openEpisodes({ status: 'attention', page: 1 })}
        />
        <Stat
          label="queue"
          value={fmtNumber(queue)}
          hint={
            overview.throughput.queue_eta_seconds
              ? `ETA ${fmtEta(overview.throughput.queue_eta_seconds)}`
              : `${fmtNumber(overview.jobs.failed_24h)} failed in 24h`
          }
          tone={queue > 0 ? 'blue' : ''}
          onClick={onOpenJobs}
        />
        <Stat
          label="blacklisted"
          value={fmtNumber(counts.blacklisted)}
          hint="kept out of the pipeline"
          tone="orange"
          onClick={() => openEpisodes({ status: 'blacklisted', page: 1 })}
        />
        <Stat
          label="discovered"
          value={fmtNumber(counts.discovered)}
          hint="waiting to process"
          tone={counts.discovered > 0 ? 'blue' : ''}
          onClick={() => openEpisodes({ status: 'discovered', page: 1 })}
        />
      </div>

      <div className="ac-grid ac-grid-2">
        <section className="ac-card">
          <div className="ac-card-header">
            <span className="ac-card-header-icon"><Gauge size={15} /></span>
            <h2>Pipeline</h2>
            <div className="ac-card-actions">
              <Badge tone={paused ? 'orange' : 'green'}>{paused ? 'paused' : 'running'}</Badge>
            </div>
          </div>

          <div className="ac-callout" style={{ marginBottom: 12 }}>
            {paused ? (
              <>
                <strong>Processing is paused.</strong> New work is not claimed by blurb. Discovery and
                queue maintenance still run.
                {overview.scheduler.consecutive_failures ? (
                  <> Auto-paused after {overview.scheduler.consecutive_failures} consecutive failures.</>
                ) : null}
              </>
            ) : (
              <>
                <strong>Processing is running.</strong> blurb claims download/transcribe jobs as they
                appear. Discovery fires on schedule.
              </>
            )}
          </div>

          <div className="ac-row">
            <Button
              variant={paused ? 'success' : 'warning'}
              icon={paused ? <Play size={13} /> : <Pause size={13} />}
              loading={admin.isPending('scheduler')}
              onClick={() => admin.schedulerAction(paused ? 'resume' : 'pause')}
            >
              {paused ? 'Resume processing' : 'Pause processing'}
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw size={13} />}
              loading={admin.isPending('discover:all:queue')}
              onClick={() => admin.discover({ auto_queue: true })}
            >
              Discover + queue
            </Button>
            <Button
              variant="ghost"
              icon={<FileSearch size={13} />}
              loading={admin.isPending('discover:all:review')}
              onClick={() => admin.discover({ auto_queue: false })}
            >
              Discover only
            </Button>
          </div>

          <div className="ac-grid ac-grid-2" style={{ marginTop: 14 }}>
            <div>
              <div className="ac-tiny ac-subtle">NEXT DISCOVERY</div>
              <div style={{ color: 'var(--ac-text)', fontSize: 12.5 }}>{fmtRelative(discoveryNext)}</div>
              <div className="ac-tiny ac-subtle">last run {fmtRelative(overview.last_runs.discovery)}</div>
            </div>
            <div>
              <div className="ac-tiny ac-subtle">NEXT RECLAIM SWEEP</div>
              <div style={{ color: 'var(--ac-text)', fontSize: 12.5 }}>{fmtRelative(reclaimNext)}</div>
              <div className="ac-tiny ac-subtle">last run {fmtRelative(overview.last_runs.reclaim)}</div>
            </div>
          </div>

          <div className="ac-grid ac-grid-3" style={{ marginTop: 12 }}>
            <div>
              <div className="ac-tiny ac-subtle">QUEUE ETA</div>
              <div style={{ color: 'var(--ac-text)', fontSize: 12.5 }}>
                {fmtEta(overview.throughput.queue_eta_seconds)}
              </div>
              <div className="ac-tiny ac-subtle">
                {overview.throughput.workers_online} worker
                {overview.throughput.workers_online === 1 ? '' : 's'} online
              </div>
            </div>
            <div>
              <div className="ac-tiny ac-subtle">THROUGHPUT</div>
              <div style={{ color: 'var(--ac-text)', fontSize: 12.5 }}>
                {overview.throughput.jobs_per_hour.toFixed(1)}/hr
              </div>
              <div className="ac-tiny ac-subtle">
                {fmtNumber(overview.throughput.completed_24h)} completed in 24h
              </div>
            </div>
            <div>
              <div className="ac-tiny ac-subtle">AVG PROCESS TIME</div>
              <div style={{ color: 'var(--ac-text)', fontSize: 12.5 }}>
                {fmtEta(overview.throughput.avg_process_seconds)}
              </div>
              <div className="ac-tiny ac-subtle">
                {overview.throughput.by_site.length
                  ? overview.throughput.by_site
                      .map((site) => `${site.site} ${fmtEta(site.avg_seconds)}`)
                      .join(' · ')
                  : 'no completed history yet'}
              </div>
            </div>
          </div>

          {counts.discovered > 0 ? (
            <div style={{ marginTop: 14 }}>
              <Button
                variant="secondary"
                icon={<ListChecks size={13} />}
                loading={admin.isPending('process-discovered')}
                onClick={() =>
                  admin.confirm({
                    title: 'Queue all discovered episodes?',
                    message: (
                      <>
                        This force-queues <strong>{fmtNumber(counts.discovered)}</strong> discovered
                        episodes for download + transcription, ignoring the auto-download toggle.
                      </>
                    ),
                    confirmLabel: 'Queue them',
                    onConfirm: async () => {
                      await admin.run('process-discovered', async () => {
                        const result = await api<{ queued: number }>(
                          '/admin/episodes/process-discovered',
                          { method: 'POST' },
                        );
                        admin.toast(`Queued ${result.queued} episode(s)`, 'ok');
                        admin.refreshAll();
                      });
                    },
                  })
                }
              >
                Queue {fmtNumber(counts.discovered)} discovered
              </Button>
            </div>
          ) : null}
        </section>

        <section className="ac-card">
          <div className="ac-card-header">
            <span className="ac-card-header-icon"><Bot size={15} /></span>
            <h2>Blurb worker</h2>
            <div className="ac-card-actions">
              <Badge tone={overview.blurb.connected ? 'green' : 'red'}>
                {overview.blurb.connected ? 'connected' : 'offline'}
              </Badge>
            </div>
          </div>

          {overview.blurb.workers.length === 0 ? (
            <EmptyState
              title="No worker has checked in"
              detail="Start blurb and point WEB_URL at this conductor. Heartbeats appear here within a minute."
            />
          ) : (
            <div className="ac-list">
              {overview.blurb.workers.map((worker) => {
                const progress = worker.progress ?? {};
                const stage = progress.stage || worker.stage || worker.state || 'idle';
                return (
                  <div className="ac-list-item" key={worker.worker_id}>
                    <span className={`ac-dot ${worker.online ? 'online' : 'offline'}`} />
                    <div className="ac-list-item-main">
                      <div className="ac-list-item-title">
                        <span className="ac-mono">{worker.worker_id.slice(0, 8)}</span>
                        <span className="ac-muted" style={{ marginLeft: 8, fontSize: 11.5 }}>
                          {titleCase(stage)}
                        </span>
                      </div>
                      <div className="ac-list-item-sub">
                        {worker.detail || (worker.job_id ? `job ${worker.job_id.slice(0, 8)}` : 'waiting for work')}
                        {' · '}
                        seen {fmtRelative(worker.last_seen_at)}
                        {worker.online ? '' : ' · last known state'}
                      </div>
                      {worker.online && progress.percent !== undefined ? (
                        <div style={{ marginTop: 5, maxWidth: 320 }}>
                          <ProgressBar percent={progress.percent} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="ac-grid ac-grid-2">
        <section className="ac-card">
          <div className="ac-card-header">
            <span className="ac-card-header-icon"><Server size={15} /></span>
            <h2>Podcast pipeline</h2>
            <div className="ac-card-actions">
              <Button variant="ghost" size="sm" onClick={() => admin.navigate('podcasts')}>
                Manage <ArrowRight size={12} />
              </Button>
            </div>
          </div>

          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>podcast</th>
                  <th style={{ textAlign: 'right' }}>queued</th>
                  <th style={{ textAlign: 'right' }}>in flight</th>
                  <th style={{ textAlign: 'right' }}>processed</th>
                  <th style={{ textAlign: 'right' }}>problems</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overview.podcasts.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState title="No podcasts yet" detail="Add one from the Podcasts page." />
                    </td>
                  </tr>
                ) : (
                  overview.podcasts.map((pod) => {
                    const problems = (pod.failed ?? 0) + (pod.orphaned ?? 0);
                    return (
                      <tr key={pod.id}>
                        <td>
                          <button
                            className="ac-row-title"
                            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                            onClick={() => openEpisodes({ podcastId: pod.id, status: 'all', page: 1 })}
                          >
                            {pod.display_name}
                          </button>
                          {!pod.enabled ? <span className="ac-tiny ac-subtle"> disabled</span> : null}
                        </td>
                        <td style={{ textAlign: 'right' }} className="ac-cell-muted">
                          {fmtNumber(pod.discovered)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="ac-cell-muted">
                          {fmtNumber(pod.downloading)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="ac-cell-muted">
                          {fmtNumber(pod.processed)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {problems > 0 ? (
                            <button
                              className="ac-badge ac-badge-red"
                              style={{ cursor: 'pointer' }}
                              onClick={() => openEpisodes({ podcastId: pod.id, status: 'attention', page: 1 })}
                            >
                              {fmtNumber(problems)}
                            </button>
                          ) : (
                            <span className="ac-cell-muted">—</span>
                          )}
                        </td>
                        <td className="is-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<RefreshCw size={12} />}
                            loading={admin.isPending(`discover:${pod.id}`)}
                            onClick={() => admin.discover({ podcast_id: pod.id, auto_queue: true })}
                            title="Run discovery for this podcast"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="ac-stack">
          <section className="ac-card">
            <div className="ac-card-header">
              <span className="ac-card-header-icon"><Activity size={15} /></span>
              <h2>Active queue</h2>
              <div className="ac-card-actions">
                <span className="ac-tiny ac-muted">{fmtNumber(queue)} active</span>
                <Button variant="ghost" size="sm" onClick={onOpenJobs}>
                  Open <ArrowRight size={12} />
                </Button>
              </div>
            </div>

            {overview.jobs.active.length === 0 ? (
              <EmptyState title="Queue is empty" detail="Everything discovered has been processed." />
            ) : (
              <div className="ac-list">
                {overview.jobs.active.slice(0, 6).map((job) => {
                  const target = jobLabel(job);
                  const stage = jobStage(job);
                  return (
                    <div className="ac-list-item" key={job.id}>
                      <Badge tone={job.kind === 'process' ? 'blue' : 'purple'}>{job.kind}</Badge>
                      <div className="ac-list-item-main">
                        <div className="ac-list-item-title ac-truncate">{target.primary}</div>
                        <div className="ac-list-item-sub">
                          {target.secondary || '—'} · {stage.label}
                          {job.claimed_by_worker ? ` · ${job.claimed_by_worker.slice(0, 8)}` : ' · waiting'}
                        </div>
                        {job.status === 'claimed' ? (
                          <div style={{ marginTop: 5 }}>
                            <ProgressBar percent={stage.percent} />
                          </div>
                        ) : null}
                      </div>
                      {job.status === 'pending' ? (
                        <button
                          className="ac-icon-btn"
                          title="Run next"
                          onClick={() => admin.jobAction('prioritize', job.id)}
                        >
                          <Sparkles size={13} />
                        </button>
                      ) : null}
                      <button
                        className="ac-icon-btn"
                        title="Job details"
                        onClick={() => onOpenJob(job.id)}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className="ac-icon-btn is-danger"
                        title="Cancel job"
                        onClick={() =>
                          admin.confirm({
                            title: 'Cancel this job?',
                            message: (
                              <>
                                Cancel the <strong>{job.kind}</strong> job for{' '}
                                <strong>{target.primary}</strong>? If blurb is already working, its
                                result will be discarded.
                              </>
                            ),
                            confirmLabel: 'Cancel job',
                            tone: 'danger',
                            onConfirm: () => admin.jobAction('cancel', job.id),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="ac-card">
            <div className="ac-card-header">
              <span className="ac-card-header-icon"><AlertTriangle size={15} /></span>
              <h2>Recent failures</h2>
              <div className="ac-card-actions">
                <Button variant="ghost" size="sm" onClick={() => admin.navigate('jobs')}>
                  History <ArrowRight size={12} />
                </Button>
              </div>
            </div>

            {overview.jobs.recent_failures.length === 0 ? (
              <EmptyState title="No recent failures" detail="The last jobs all completed cleanly." />
            ) : (
              <div className="ac-list">
                {overview.jobs.recent_failures.slice(0, 5).map((job) => {
                  const target = jobLabel(job);
                  return (
                    <div className="ac-list-item" key={job.id}>
                      <XCircle size={14} style={{ color: 'var(--ac-red)', flex: 'none' }} />
                      <div className="ac-list-item-main">
                        <div className="ac-list-item-title ac-truncate">{target.primary}</div>
                        <div className="ac-list-item-sub" title={job.error ?? ''}>
                          {job.error_type ? `${job.error_type}: ` : ''}
                          {job.error || 'unknown error'}
                        </div>
                      </div>
                      <div className="ac-list-item-sub ac-nowrap">{fmtRelative(job.finished_at || job.created_at)}</div>
                      <button
                        className="ac-icon-btn"
                        title="Job details"
                        onClick={() => onOpenJob(job.id)}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className="ac-icon-btn"
                        title="Retry job"
                        onClick={() => admin.jobAction('retry', job.id)}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="ac-row ac-subtle ac-tiny" style={{ justifyContent: 'flex-end' }}>
        <CalendarClock size={12} /> snapshot {fmtDateTime(overview.generated_at)}
        <span className="ac-sep" />
        <Timer size={12} /> live updates via SSE
      </div>
    </div>
  );
}
