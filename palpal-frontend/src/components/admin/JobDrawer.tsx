'use client';

import React, { useEffect, useState } from 'react';
import {
  Ban,
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

  if (!jobId) return null;

  const target = job ? jobLabel(job) : null;
  const progress = job?.progress ?? {};

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
