'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Download,
  MousePointerClick,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type {
  AnalyticsClip,
  AnalyticsDailyPoint,
  AnalyticsData,
  AnalyticsQuery,
} from './types';
import {
  Button,
  EmptyState,
  Spinner,
  Stat,
  fmtNumber,
  fmtRelative,
} from './ui';

const RANGES = [7, 30, 90, 180];

function pct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
) {
  const escape = (value: string | number | boolean | null | undefined) => {
    let text = value === null || value === undefined ? '' : String(value);
    // Prevent spreadsheet formula injection from user-controlled query text.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function DailyChart({ daily }: { daily: AnalyticsDailyPoint[] }) {
  const max = useMemo(
    () => Math.max(1, ...daily.map((point) => Math.max(point.searches, point.opens))),
    [daily],
  );
  const labelStep = Math.max(1, Math.ceil(daily.length / 8));

  if (!daily.length) {
    return <EmptyState title="No daily data yet" detail="Searches will appear here as they happen." />;
  }

  return (
    <div className="ac-chart" role="img" aria-label="Daily searches and result opens">
      {daily.map((point, index) => (
        <div
          className="ac-chart-day"
          key={point.day}
          title={`${point.day}: ${fmtNumber(point.searches)} searches, ${fmtNumber(point.unique_searchers)} unique searchers, ${fmtNumber(point.opens)} opens`}
        >
          <div className="ac-chart-bars">
            <span
              className="ac-chart-bar"
              style={{ height: `${Math.max(1, (point.searches / max) * 100)}%` }}
            />
            <span
              className="ac-chart-bar is-opens"
              style={{ height: `${Math.max(1, (point.opens / max) * 100)}%` }}
            />
          </div>
          {index % labelStep === 0 || index === daily.length - 1 ? (
            <span className="ac-chart-label">{point.day.slice(5)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function QueryTable({
  rows,
  mode,
  onExport,
}: {
  rows: AnalyticsQuery[];
  mode: 'top' | 'zero';
  onExport: () => void;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title={mode === 'top' ? 'No searches in this range' : 'No zero-result searches'}
        detail={mode === 'top' ? 'Try a wider date range.' : 'Nothing needs an index/content fix here.'}
      />
    );
  }

  return (
    <>
      <div className="ac-row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={onExport}>
          CSV
        </Button>
      </div>
      <div className="ac-table-wrap">
        <table className="ac-table">
          <thead>
            <tr>
              <th>Query</th>
              <th>{mode === 'top' ? 'Searches' : 'Zero results'}</th>
              <th>{mode === 'top' ? 'Zero-result rate' : 'Searches'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rate = row.zero_result_rate ?? (
                row.searches ? row.zero_result_searches / row.searches : 0
              );
              return (
                <tr key={row.query}>
                  <td><span className="ac-row-title">{row.query}</span></td>
                  <td className="ac-cell-mono">
                    {fmtNumber(mode === 'top' ? row.searches : row.zero_result_searches)}
                  </td>
                  <td className="ac-cell-mono">
                    {mode === 'top' ? pct(rate) : fmtNumber(row.searches)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function AnalyticsView({
  onOpenEpisode,
}: {
  onOpenEpisode?: (episodeId: string) => void;
}) {
  const admin = useAdmin();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<AnalyticsData>(`/admin/analytics?days=${days}`);
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeDays = useMemo(
    () => data?.daily.filter((point) => point.searches > 0).length ?? 0,
    [data],
  );

  const openPodcastEpisodes = useCallback(
    (podcastId: string) => {
      admin.navigate('episodes', {
        episodeFilters: {
          podcastId,
          status: 'all',
          site: 'all',
          q: '',
          page: 1,
        },
      });
    },
    [admin],
  );

  if (!data && loading) {
    return (
      <div className="ac-card" style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={20} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ac-card" style={{ padding: 40, textAlign: 'center' }}>
        <div className="ac-empty-title">Could not load analytics</div>
        <div className="ac-empty-detail">{error || 'Unknown error'}</div>
        <div style={{ marginTop: 14 }}>
          <Button size="sm" icon={<RefreshCw size={12} />} onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const totals = data.totals;

  return (
    <div className="ac-stack">
      <div className="ac-toolbar" style={{ marginBottom: 0 }}>
        <div className="ac-tabs" style={{ marginBottom: 0 }}>
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className={`ac-tab ${days === range ? 'is-active' : ''}`}
              onClick={() => setDays(range)}
            >
              {range}d
            </button>
          ))}
        </div>
        <div className="ac-row-end ac-row">
          <span className="ac-tiny ac-subtle">
            {data.range.from} → {data.range.to} · {data.timezone.replace('_', ' ')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={loading ? <Spinner /> : <RefreshCw size={12} />}
            loading={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="ac-callout is-danger">
          Could not refresh analytics: {error}
        </div>
      ) : null}

      <div className="ac-callout">
        <strong>Aggregate only.</strong> No IP addresses, user IDs, or individual events are stored.
        Unique searchers are approximate daily counts and are not linked across days, so the range
        figure below is searcher-days, not unique people.
      </div>

      <div className="ac-stats">
        <Stat
          label="searches"
          value={fmtNumber(totals.searches)}
          hint={`${fmtNumber(totals.avg_daily_searches)} / day`}
        />
        <Stat
          label="unique searchers / day"
          value={totals.avg_daily_unique_searchers.toFixed(1)}
          hint={`${fmtNumber(totals.unique_searcher_days)} searcher-days`}
          tone="blue"
        />
        <Stat
          label="result opens"
          value={fmtNumber(totals.opens)}
          hint="outbound watch links"
          tone="green"
        />
        <Stat
          label="zero-result rate"
          value={pct(totals.zero_result_rate)}
          hint={`${fmtNumber(totals.zero_result_searches)} searches`}
          tone={totals.zero_result_rate >= 0.2 ? 'yellow' : ''}
        />
        <Stat
          label="corrected queries"
          value={fmtNumber(totals.corrected_searches)}
          hint="spelling corrections applied"
        />
        <Stat
          label="active days"
          value={fmtNumber(activeDays)}
          hint={`of ${days}`}
        />
      </div>

      <section className="ac-card">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><BarChart3 size={15} /></span>
          <h2>Searches and opens</h2>
          <div className="ac-card-actions">
            <span className="ac-tiny ac-subtle"><span className="ac-legend-dot" /> searches</span>
            <span className="ac-tiny ac-subtle"><span className="ac-legend-dot is-opens" /> opens</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={12} />}
              onClick={() =>
                downloadCsv(
                  `palpal-daily-${days}d.csv`,
                  ['day', 'searches', 'unique_searchers', 'zero_result_searches', 'corrected_searches', 'opens'],
                  data.daily.map((row) => [
                    row.day,
                    row.searches,
                    row.unique_searchers,
                    row.zero_result_searches,
                    row.corrected_searches,
                    row.opens,
                  ]),
                )
              }
            >
              CSV
            </Button>
          </div>
        </div>
        <DailyChart daily={data.daily} />
      </section>

      <div className="ac-grid ac-grid-2" style={{ alignItems: 'start' }}>
        <section className="ac-card">
          <div className="ac-card-header">
            <span className="ac-card-header-icon"><Search size={15} /></span>
            <h2>Top searches</h2>
          </div>
          <QueryTable
            rows={data.top_queries}
            mode="top"
            onExport={() =>
              downloadCsv(
                `palpal-queries-${days}d.csv`,
                ['query', 'searches', 'zero_result_searches', 'zero_result_rate'],
                data.top_queries.map((row) => [
                  row.query,
                  row.searches,
                  row.zero_result_searches,
                  row.zero_result_rate ?? (row.searches ? row.zero_result_searches / row.searches : 0),
                ]),
              )
            }
          />
        </section>

        <section className="ac-card">
          <div className="ac-card-header">
            <span className="ac-card-header-icon"><AlertTriangle size={15} /></span>
            <h2>Zero-result searches</h2>
          </div>
          <QueryTable
            rows={data.zero_result_queries}
            mode="zero"
            onExport={() =>
              downloadCsv(
                `palpal-zero-results-${days}d.csv`,
                ['query', 'zero_result_searches', 'searches'],
                data.zero_result_queries.map((row) => [
                  row.query,
                  row.zero_result_searches,
                  row.searches,
                ]),
              )
            }
          />
        </section>
      </div>

      <section className="ac-card">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><MousePointerClick size={15} /></span>
          <h2>Podcast interest</h2>
          <div className="ac-card-actions">
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={12} />}
              onClick={() =>
                downloadCsv(
                  `palpal-podcasts-${days}d.csv`,
                  ['podcast_id', 'podcast', 'enabled', 'impressions', 'filtered_searches', 'opens', 'open_rate', 'last_open'],
                  data.podcasts.map((row) => [
                    row.podcast_id,
                    row.display_name,
                    row.enabled,
                    row.impressions,
                    row.filtered_searches,
                    row.opens,
                    row.open_rate,
                    row.last_open,
                  ]),
                )
              }
            >
              CSV
            </Button>
          </div>
        </div>
        <p className="ac-tiny ac-subtle" style={{ marginTop: -8, marginBottom: 12 }}>
          Impressions = appeared in the top 10 results. Opens = outbound watch link clicks.
          Open rate = opens / impressions.
        </p>
        {data.podcasts.length ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Impressions</th>
                  <th>Filtered searches</th>
                  <th>Opens</th>
                  <th>Open rate</th>
                  <th>Last open</th>
                </tr>
              </thead>
              <tbody>
                {data.podcasts.map((podcast) => (
                  <tr key={podcast.podcast_id}>
                    <td>
                      <span className="ac-row-title">{podcast.display_name}</span>
                      <span className="ac-row-sub">
                        {podcast.enabled ? 'enabled' : 'disabled'} · {podcast.podcast_id}
                      </span>
                    </td>
                    <td className="ac-cell-mono">{fmtNumber(podcast.impressions)}</td>
                    <td className="ac-cell-mono">{fmtNumber(podcast.filtered_searches)}</td>
                    <td className="ac-cell-mono">{fmtNumber(podcast.opens)}</td>
                    <td className="ac-cell-mono">{pct(podcast.open_rate)}</td>
                    <td className="ac-cell-muted">
                      {podcast.last_open ? fmtRelative(podcast.last_open) : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No podcasts found" />
        )}
      </section>

      {data.review_candidates.length ? (
        <section className="ac-card">
          <div className="ac-card-header">
            <span className="ac-card-header-icon" style={{ color: 'var(--ac-yellow)' }}>
              <AlertTriangle size={15} />
            </span>
            <h2>Review candidates</h2>
          </div>
          <div className="ac-callout is-warning" style={{ marginBottom: 12 }}>
            These podcasts appeared in results but had no outbound opens in the selected range.
            Small samples can be misleading, so use this as a prompt to review, not an automatic
            removal rule.
          </div>
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Impressions</th>
                  <th>Filtered searches</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.review_candidates.map((podcast) => (
                  <tr key={podcast.podcast_id}>
                    <td>
                      <span className="ac-row-title">{podcast.display_name}</span>
                      <span className="ac-row-sub">{podcast.podcast_id}</span>
                    </td>
                    <td className="ac-cell-mono">{fmtNumber(podcast.impressions)}</td>
                    <td className="ac-cell-mono">{fmtNumber(podcast.filtered_searches)}</td>
                    <td className="is-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openPodcastEpisodes(podcast.podcast_id)}
                      >
                        Episodes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="ac-card">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><BarChart3 size={15} /></span>
          <h2>Most opened clips</h2>
          <div className="ac-card-actions">
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={12} />}
              disabled={!data.top_clips.length}
              onClick={() =>
                downloadCsv(
                  `palpal-clips-${days}d.csv`,
                  ['episode', 'podcast', 'start', 'opens', 'last_opened', 'text'],
                  data.top_clips.map((clip) => [
                    clip.episode_title,
                    clip.podcast_name,
                    clip.start_formatted,
                    clip.opens,
                    clip.last_opened,
                    clip.text,
                  ]),
                )
              }
            >
              CSV
            </Button>
          </div>
        </div>
        {data.top_clips.length ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>Clip</th>
                  <th>Podcast</th>
                  <th>Start</th>
                  <th>Opens</th>
                  <th>Last opened</th>
                </tr>
              </thead>
              <tbody>
                {data.top_clips.map((clip) => (
                  <ClipRow
                    key={`${clip.chunk_id}-${clip.last_opened ?? ''}`}
                    clip={clip}
                    onOpenEpisode={onOpenEpisode}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No clip opens yet"
            detail="Outbound watch-link clicks will show up here."
          />
        )}
      </section>

      <div className="ac-row ac-tiny ac-subtle" style={{ justifyContent: 'space-between' }}>
        <span>
          Retention: query text {data.retention.query_days} days · aggregate statistics{' '}
          {data.retention.aggregate_days} days.
        </span>
        <span>Days are counted in {data.timezone.replace('_', ' ')}.</span>
      </div>
    </div>
  );
}

function ClipRow({
  clip,
  onOpenEpisode,
}: {
  clip: AnalyticsClip;
  onOpenEpisode?: (episodeId: string) => void;
}) {
  const content = (
    <>
      <span className="ac-row-title">{clip.episode_title || 'Episode removed'}</span>
      {clip.text ? <span className="ac-row-sub">{clip.text}</span> : null}
    </>
  );

  return (
    <tr>
      <td>
        {onOpenEpisode && clip.episode_id ? (
          <button
            type="button"
            className="ac-link-button"
            onClick={() => onOpenEpisode(clip.episode_id as string)}
          >
            {content}
          </button>
        ) : (
          content
        )}
      </td>
      <td>{clip.podcast_name}</td>
      <td className="ac-cell-mono">{clip.start_formatted || '—'}</td>
      <td className="ac-cell-mono">{fmtNumber(clip.opens)}</td>
      <td className="ac-cell-muted">
        {clip.last_opened ? fmtRelative(clip.last_opened) : '—'}
      </td>
    </tr>
  );
}
