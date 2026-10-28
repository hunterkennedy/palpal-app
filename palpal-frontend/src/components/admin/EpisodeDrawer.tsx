'use client';

import React, { useEffect, useState } from 'react';
import {
  Ban,
  ExternalLink,
  Eye,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { Episode, EpisodeDetail } from './types';
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
  titleCase,
  episodeUrl,
} from './ui';

export default function EpisodeDrawer({
  episodeId,
  seed,
  refreshKey,
  onClose,
  onOpenJob,
}: {
  episodeId: string | null;
  seed?: Episode | null;
  refreshKey: number;
  onClose: () => void;
  onOpenJob: (jobId: string) => void;
}) {
  const admin = useAdmin();
  const [detail, setDetail] = useState<EpisodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!episodeId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<EpisodeDetail>(`/admin/episodes/${episodeId}`)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
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
  }, [episodeId, refreshKey]);

  useEffect(() => {
    if (!episodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [episodeId, onClose]);

  if (!episodeId) return null;

  const episode = detail?.episode ?? seed ?? null;
  const jobs = detail?.jobs ?? [];
  const sourceUrl = episode ? episodeUrl(episode) : null;

  return (
    <div className="ac-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ac-drawer" role="dialog" aria-modal>
        <header className="ac-drawer-header">
          <div className="ac-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="ac-row" style={{ gap: 6, marginBottom: 6 }}>
                {episode ? <Badge>{episode.status}</Badge> : null}
                {episode?.blacklisted ? <Badge tone="orange">blacklisted</Badge> : null}
                {episode ? <Badge tone="gray">{episode.site}</Badge> : null}
              </div>
              <h2>{episode?.title || 'Episode'}</h2>
              <div className="ac-tiny ac-subtle" style={{ marginTop: 4 }}>
                {episode ? `${episode.podcast_name} · ${episode.source_name}` : ''}
              </div>
            </div>
            <button className="ac-icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="ac-drawer-body">
          {loading && !detail ? (
            <div style={{ padding: 30, textAlign: 'center' }}>
              <Spinner size={18} />
            </div>
          ) : error ? (
            <div className="ac-callout is-danger">{error}</div>
          ) : episode ? (
            <>
              {episode.error_message ? (
                <div className="ac-callout is-danger">
                  <strong>Last error:</strong> {episode.error_message}
                </div>
              ) : null}

              <div className="ac-grid ac-grid-2">
                <Meta label="Published" value={episode.publication_date ?? '—'} />
                <Meta label="Length" value={fmtDuration(episode.duration_seconds)} />
                <Meta label="Video / post ID" value={<CopyText value={episode.video_id} />} />
                <Meta label="Episode ID" value={<CopyText value={episode.id} />} />
                <Meta label="Podcast" value={episode.podcast_name} />
                <Meta label="Source" value={episode.source_name} />
                <Meta label="Created" value={fmtDateTime(episode.created_at)} />
                <Meta label="Updated" value={fmtDateTime(episode.updated_at)} />
                {detail ? (
                  <Meta
                    label="Transcript"
                    value={`${fmtNumber(detail.episode.chunk_count)} chunks · ${fmtNumber(detail.episode.word_count)} words`}
                  />
                ) : null}
              </div>

              <div className="ac-row">
                {episode.status === 'discovered' ? (
                  <Button variant="secondary" size="sm" icon={<Play size={12} />} onClick={() => admin.episodeAction('process', episode.id)}>
                    Process now
                  </Button>
                ) : null}
                {episode.status === 'failed' || episode.status === 'downloading' ? (
                  <Button variant="warning" size="sm" icon={<RotateCcw size={12} />} onClick={() => admin.episodeAction('retry', episode.id)}>
                    Retry
                  </Button>
                ) : null}
                {episode.status === 'processed' ? (
                  <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={() => admin.episodeAction('retranscribe', episode.id)}>
                    Re-transcribe
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Ban size={12} />}
                  onClick={() => admin.episodeAction(episode.blacklisted ? 'unblacklist' : 'blacklist', episode.id)}
                >
                  {episode.blacklisted ? 'Remove blacklist' : 'Blacklist'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ExternalLink size={12} />}
                  disabled={!sourceUrl}
                  onClick={() => {
                    if (sourceUrl) window.open(sourceUrl, '_blank', 'noopener,noreferrer');
                  }}
                >
                  Open source
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 size={12} />}
                  onClick={() =>
                    admin.confirm({
                      title: 'Delete episode?',
                      message: (
                        <>
                          Permanently delete <strong>{episode.title}</strong>, its search chunks, and its
                          stored transcript.
                        </>
                      ),
                      confirmLabel: 'Delete',
                      tone: 'danger',
                      onConfirm: async () => {
                        const ok = await admin.episodeAction('delete', episode.id);
                        if (ok) onClose();
                      },
                    })
                  }
                >
                  Delete
                </Button>
              </div>

              <section>
                <div className="ac-card-header" style={{ marginBottom: 8 }}>
                  <h2>Job history</h2>
                </div>
                {jobs.length === 0 ? (
                  <EmptyState title="No jobs yet" detail="This episode has never been claimed by a worker." />
                ) : (
                  <div className="ac-table-wrap">
                    <table className="ac-table">
                      <thead>
                        <tr>
                          <th>status</th>
                          <th>attempts</th>
                          <th>stage</th>
                          <th>created</th>
                          <th>finished</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.map((job) => {
                          const progress = job.progress ?? {};
                          return (
                            <React.Fragment key={job.id}>
                              <tr className="is-clickable" onClick={() => onOpenJob(job.id)}>
                                <td>
                                  <Badge>{job.status}</Badge>
                                </td>
                                <td className="ac-cell-muted">{job.attempts ?? 0}</td>
                                <td className="ac-cell-muted">
                                  {progress.stage ? titleCase(progress.stage) : '—'}
                                  {progress.percent !== undefined ? ` ${progress.percent.toFixed(0)}%` : ''}
                                </td>
                                <td className="ac-cell-muted">{fmtRelative(job.created_at)}</td>
                                <td className="ac-cell-muted">{job.finished_at ? fmtRelative(job.finished_at) : '—'}</td>
                                <td className="is-actions">
                                  <Eye size={12} className="ac-subtle" />
                                </td>
                              </tr>
                              {job.error ? (
                                <tr>
                                  <td colSpan={6} style={{ paddingTop: 0 }}>
                                    <div className="ac-row-sub is-error" style={{ whiteSpace: 'normal', maxWidth: 'none' }}>
                                      {job.error_type ? `${job.error_type}: ` : ''}
                                      {job.error}
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                              {job.status === 'claimed' && progress.percent !== undefined ? (
                                <tr>
                                  <td colSpan={6} style={{ paddingTop: 0 }}>
                                    <ProgressBar percent={progress.percent} height={4} />
                                  </td>
                                </tr>
                              ) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {detail && detail.episode.first_chunk_at !== null && detail.episode.first_chunk_at !== undefined ? (
                <div className="ac-callout">
                  Transcript spans {fmtDuration(Number(detail.episode.first_chunk_at))} –{' '}
                  {fmtDuration(Number(detail.episode.last_chunk_at))}.
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState title="Episode not found" />
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
