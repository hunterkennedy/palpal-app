'use client';

import React, { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Eye,
  Sparkles,
  RotateCcw,
  X,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { Job } from './types';
import {
  Badge,
  Button,
  CopyText,
  EmptyState,
  ProgressBar,
  Spinner,
  fmtDateTime,
  fmtDuration,
  fmtNumber,
  fmtRelative,
  jobLabel,
  titleCase,
} from './ui';

export default function JobDrawer({
  jobId,
  refreshKey,
  onClose,
  onOpenEpisode,
}: {
  jobId: string | null;
  refreshKey: number;
  onClose: () => void;
  onOpenEpisode: (episodeId: string) => void;
}) {
  const admin = useAdmin();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<Job>(`/admin/jobs/${jobId}`)
      .then((data) => {
        if (!cancelled) {
          setJob(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);

  useEffect(() => {
    if (!jobId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobId, onClose]);

  async function applyRebind() {
    if (!job?.source_id || !job.dry_run_result) return;
    const preview = job.dry_run_result;
    admin.confirm({
      title: 'Apply this source rebind?',
      message: (
        <>
          Update <strong>{job.source_name ?? job.source_id}</strong> to the previewed URL
          and reconcile its episodes:
          <br />
          {fmtNumber(preview.matched ?? 0)} matched · {fmtNumber(preview.would_add ?? 0)} added ·{' '}
          {fmtNumber(preview.would_orphan ?? 0)} orphaned ·{' '}
          {fmtNumber(preview.metadata?.failed_retried ?? 0)} failed retried.
          <br />
          Nothing is deleted; unmatched episodes are marked orphaned and can be restored.
        </>
      ),
      confirmLabel: 'Apply rebind',
      tone: 'primary',
      onConfirm: async () => {
        await admin.run(`source-apply:${job.id}`, async () => {
          const applied = await api<{
            matched: number;
            added: number;
            orphaned: number;
            retried: number;
            rebound: number;
            reactivated: number;
          }>(`/admin/sources/${job.source_id}/apply-url`, {
            method: 'POST',
            body: JSON.stringify({ job_id: job.id }),
          });
          admin.toast('Source rebound', 'ok', {
            detail:
              `${fmtNumber(applied.matched)} matched · ${fmtNumber(applied.added)} added · `
              + `${fmtNumber(applied.orphaned)} orphaned · ${fmtNumber(applied.retried)} retried`,
          });
          onClose();
          admin.refreshAll();
        });
      },
    });
  }

  if (!jobId) return null;

  const target = job ? jobLabel(job) : null;
  const progress = job?.progress ?? {};
  const dryRun = job?.dry_run_result ?? null;
  const isRebind = dryRun?.kind === 'source_rebind';

  return (
    <div className="ac-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ac-drawer" role="dialog" aria-modal>
        <header className="ac-drawer-header">
          <div className="ac-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="ac-row" style={{ gap: 6, marginBottom: 6 }}>
                {job ? <Badge tone={job.kind === 'process' ? 'blue' : 'purple'}>{job.kind}</Badge> : null}
                {job ? <Badge>{job.status}</Badge> : null}
                {job && job.priority ? <Badge tone="orange">priority</Badge> : null}
              </div>
              <h2>{target?.primary ?? 'Job'}</h2>
              <div className="ac-tiny ac-subtle" style={{ marginTop: 4 }}>
                {target?.secondary || ''}
              </div>
            </div>
            <button type="button" className="ac-icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="ac-drawer-body">
          {loading && !job ? (
            <div style={{ padding: 30, textAlign: 'center' }}>
              <Spinner size={18} />
            </div>
          ) : error ? (
            <div className="ac-callout is-danger">{error}</div>
          ) : job ? (
            <>
              {job.status === 'claimed' ? (
                <div>
                  <div className="ac-stage-label" style={{ marginBottom: 5 }}>
                    <span>{titleCase(progress.stage || 'claimed')}</span>
                    <b>{progress.percent !== undefined ? `${progress.percent.toFixed(0)}%` : 'in progress'}</b>
                  </div>
                  <ProgressBar percent={progress.percent} />
                  {progress.detail ? <div className="ac-tiny ac-subtle" style={{ marginTop: 4 }}>{progress.detail}</div> : null}
                </div>
              ) : null}

              {job.error ? (
                <div className="ac-callout is-danger" style={{ whiteSpace: 'pre-wrap' }}>
                  <strong>{job.error_type ? `${job.error_type}: ` : 'Error: '}</strong>
                  {job.error}
                </div>
              ) : null}

              <div className="ac-grid ac-grid-2">
                <Meta label="Job ID" value={<CopyText value={job.id} />} />
                <Meta
                  label="Worker"
                  value={job.claimed_by_worker ? <CopyText value={job.claimed_by_worker} /> : '—'}
                />
                <Meta label="Created" value={fmtDateTime(job.created_at)} />
                <Meta label="Claimed" value={job.claimed_at ? fmtDateTime(job.claimed_at) : '—'} />
                <Meta label="Finished" value={job.finished_at ? fmtDateTime(job.finished_at) : '—'} />
                <Meta label="Last progress" value={fmtRelative(job.progress_at)} />
                <Meta label="Attempts" value={job.attempts ?? 0} />
                <Meta label="Priority" value={job.priority ?? 0} />
              </div>

              <div className="ac-row">
                {job.status === 'pending' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Sparkles size={12} />}
                    onClick={() => admin.jobAction('prioritize', job.id)}
                  >
                    Move to front
                  </Button>
                ) : null}
                {job.status === 'pending' || job.status === 'claimed' ? (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Ban size={12} />}
                    onClick={() =>
                      admin.confirm({
                        title: 'Cancel this job?',
                        message: (
                          <>
                            Cancel the <strong>{job.kind}</strong> job for{' '}
                            <strong>{target?.primary}</strong>? A result already in flight from blurb will
                            be discarded.
                          </>
                        ),
                        confirmLabel: 'Cancel job',
                        tone: 'danger',
                        onConfirm: async () => {
                          await admin.jobAction('cancel', job.id);
                          onClose();
                        },
                      })
                    }
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RotateCcw size={12} />}
                    onClick={() => admin.jobAction('retry', job.id)}
                  >
                    Retry job
                  </Button>
                )}
                {job.episode_id ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Eye size={12} />}
                    onClick={() => onOpenEpisode(job.episode_id as string)}
                  >
                    Open episode
                  </Button>
                ) : null}
                {job.has_result ? (
                  <span className="ac-tiny ac-subtle">Result stored on conductor</span>
                ) : null}
              </div>

              {job.episode_id ? (
                <div className="ac-grid ac-grid-2">
                  <Meta label="Episode ID" value={<CopyText value={job.episode_id} />} />
                  <Meta label="Episode" value={job.episode_title ?? '—'} />
                </div>
              ) : null}
              {job.source_id ? (
                <div className="ac-grid ac-grid-2">
                  <Meta label="Source ID" value={<CopyText value={job.source_id} />} />
                  <Meta label="Source" value={job.source_name ?? '—'} />
                </div>
              ) : null}

              <section>
                <div className="ac-card-header" style={{ marginBottom: 8 }}>
                  <h2>Timeline</h2>
                  <div className="ac-card-actions ac-tiny ac-subtle">
                    {job.events?.length ?? 0} events
                  </div>
                </div>
                {job.events?.length ? (
                  <div className="ac-timeline">
                    {job.events.map((event) => (
                      <div className={`ac-timeline-item is-${event.level}`} key={event.id}>
                        <span className="ac-timeline-dot" />
                        <div className="ac-timeline-main">
                          <div className="ac-timeline-message">{event.message}</div>
                          <div className="ac-timeline-meta">
                            {fmtDateTime(event.created_at)}
                            {event.stage ? ` · ${event.stage}` : ''}
                            {event.percent !== null && event.percent !== undefined
                              ? ` · ${event.percent.toFixed(0)}%`
                              : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ac-callout">No events recorded yet.</div>
                )}
              </section>

              {dryRun ? (
                <section>
                  <div className="ac-card-header" style={{ marginBottom: 8 }}>
                    <h2>{isRebind ? 'Rebind preview' : 'Dry-run result'}</h2>
                    <div className="ac-card-actions">
                      <Badge tone={dryRun.applied_at ? 'green' : 'blue'}>
                        {dryRun.applied_at ? 'applied' : 'no changes applied'}
                      </Badge>
                      {isRebind && job.status === 'completed' && !dryRun.applied_at ? (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<Check size={12} />}
                          loading={admin.isPending(`source-apply:${job.id}`)}
                          onClick={applyRebind}
                        >
                          Apply rebind
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {isRebind ? (
                    <>
                      <div className="ac-grid ac-grid-3" style={{ marginBottom: 8 }}>
                        <Meta label="Matched" value={fmtNumber(dryRun.matched ?? 0)} />
                        <Meta label="Would add" value={fmtNumber(dryRun.would_add ?? 0)} />
                        <Meta label="Would orphan" value={fmtNumber(dryRun.would_orphan ?? 0)} />
                        <Meta label="Retry failed" value={fmtNumber(dryRun.metadata?.failed_retried ?? 0)} />
                        <Meta label="Durations filled" value={fmtNumber(dryRun.metadata?.duration_filled ?? 0)} />
                        <Meta label="Ambiguous" value={fmtNumber(dryRun.ambiguous_count ?? 0)} />
                      </div>
                      <div className="ac-tiny ac-subtle" style={{ marginBottom: 10 }}>
                        {fmtNumber(dryRun.matched_exact ?? 0)} exact ID ·{' '}
                        {fmtNumber(dryRun.matched_canonical ?? 0)} canonical ·{' '}
                        {fmtNumber(dryRun.matched_title_date ?? 0)} title/date ·{' '}
                        {fmtNumber(dryRun.matched_title ?? 0)} title
                      </div>

                      {dryRun.sample_adds?.length ? (
                        <div style={{ marginBottom: 12 }}>
                          <div className="ac-stage-label" style={{ marginBottom: 5 }}>
                            <span>Would add</span>
                            <b>{fmtNumber(dryRun.would_add ?? 0)}</b>
                          </div>
                          <div className="ac-table-wrap">
                            <table className="ac-table">
                              <thead>
                                <tr><th>title</th><th>published</th><th>length</th></tr>
                              </thead>
                              <tbody>
                                {dryRun.sample_adds.map((entry) => (
                                  <tr key={entry.video_id}>
                                    <td className="ac-truncate" title={entry.title}>{entry.title || '(untitled)'}</td>
                                    <td className="ac-cell-muted">{entry.pub_date ?? '—'}</td>
                                    <td className="ac-cell-muted">{fmtDuration(entry.duration)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}

                      {dryRun.sample_orphans?.length ? (
                        <div style={{ marginBottom: 12 }}>
                          <div className="ac-stage-label" style={{ marginBottom: 5 }}>
                            <span>Would orphan</span>
                            <b>{fmtNumber(dryRun.would_orphan ?? 0)}</b>
                          </div>
                          <div className="ac-table-wrap">
                            <table className="ac-table">
                              <thead>
                                <tr><th>title</th><th>published</th><th>status</th></tr>
                              </thead>
                              <tbody>
                                {dryRun.sample_orphans.map((entry) => (
                                  <tr key={entry.video_id}>
                                    <td className="ac-truncate" title={entry.title}>{entry.title || '(untitled)'}</td>
                                    <td className="ac-cell-muted">{entry.pub_date ?? '—'}</td>
                                    <td className="ac-cell-muted">{entry.status ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}

                      {dryRun.ambiguous_count ? (
                        <div className="ac-callout is-danger">
                          <strong>{fmtNumber(dryRun.ambiguous_count)} ambiguous</strong>
                          <ul style={{ margin: '6px 0 0 16px' }}>
                            {dryRun.ambiguous?.slice(0, 5).map((item) => (
                              <li key={`${item.video_id}-${item.reason}`}>
                                {item.title || item.video_id}: {item.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="ac-grid ac-grid-3" style={{ marginBottom: 12 }}>
                        <Meta label="Entries" value={fmtNumber(dryRun.entry_count)} />
                        <Meta label="Would import" value={fmtNumber(dryRun.would_import)} />
                        <Meta label="Already known" value={fmtNumber(dryRun.already_known)} />
                        <Meta label="Title excluded" value={fmtNumber(dryRun.title_excluded)} />
                        <Meta label="Unavailable" value={fmtNumber(dryRun.unavailable)} />
                        <Meta label="Too short" value={fmtNumber(dryRun.too_short)} />
                        <Meta label="Would orphan" value={fmtNumber(dryRun.would_orphan)} />
                        <Meta label="Min duration" value={`${fmtNumber(dryRun.min_duration_seconds)}s`} />
                      </div>
                      {dryRun.sample?.length ? (
                        <div className="ac-table-wrap">
                          <table className="ac-table">
                            <thead>
                              <tr>
                                <th>title</th>
                                <th>published</th>
                                <th>length</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dryRun.sample.map((entry) => (
                                <tr key={entry.video_id}>
                                  <td className="ac-truncate" title={entry.title}>{entry.title || '(untitled)'}</td>
                                  <td className="ac-cell-muted">{entry.pub_date ?? '—'}</td>
                                  <td className="ac-cell-muted">{fmtDuration(entry.duration)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              ) : null}

              <section>
                <div className="ac-card-header" style={{ marginBottom: 8 }}>
                  <h2>Payload</h2>
                  <div className="ac-card-actions">
                    <CopyText
                      value={JSON.stringify(job.payload ?? {}, null, 2)}
                      label="payload JSON"
                      display="Copy"
                      mono={false}
                    />
                  </div>
                </div>
                <pre className="ac-code-block">{JSON.stringify(job.payload ?? {}, null, 2)}</pre>
              </section>
            </>
          ) : (
            <EmptyState title="Job not found" />
          )}
        </div>
      </aside>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="ac-tiny ac-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {label}
      </div>
      <div style={{ color: 'var(--ac-text-2)', fontSize: 12.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}
