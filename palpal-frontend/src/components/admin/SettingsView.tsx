'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Database,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Trash2,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { Overview } from './types';
import {
  Button,
  Modal,
  Spinner,
  Toggle,
  fmtDateTime,
  fmtNumber,
  fmtRelative,
} from './ui';

export default function SettingsView({
  overview,
  loading,
}: {
  overview: Overview | null;
  loading: boolean;
}) {
  const admin = useAdmin();
  const [minDur, setMinDur] = useState('0');
  const [chunkWords, setChunkWords] = useState('50');
  const [retentionDays, setRetentionDays] = useState('0');
  const [schedule, setSchedule] = useState('0 */6 * * *');
  const [analyticsQueryDays, setAnalyticsQueryDays] = useState('180');
  const [analyticsAggregateDays, setAnalyticsAggregateDays] = useState('730');
  const [rechunkOpen, setRechunkOpen] = useState(false);
  const [rechunkInfo, setRechunkInfo] = useState<{ queued: number; target_words: number } | null>(null);
  const [rechunkText, setRechunkText] = useState('');

  const minDurSetting = overview?.settings.min_episode_duration_seconds;
  const chunkWordsSetting = overview?.settings.chunk_target_words;
  const retentionSetting = overview?.settings.job_history_retention_days;
  const scheduleSetting = overview?.settings.discovery_schedule;
  const analyticsQueryRetentionSetting = overview?.settings.analytics_query_retention_days;
  const analyticsAggregateRetentionSetting = overview?.settings.analytics_aggregate_retention_days;

  useEffect(() => {
    if (minDurSetting === undefined && chunkWordsSetting === undefined) return;
    setMinDur(String(minDurSetting ?? 0));
    setChunkWords(String(chunkWordsSetting ?? 50));
    setRetentionDays(String(retentionSetting ?? 0));
    setSchedule(scheduleSetting || '0 */6 * * *');
  }, [minDurSetting, chunkWordsSetting, retentionSetting, scheduleSetting]);

  useEffect(() => {
    if (analyticsQueryRetentionSetting === undefined) return;
    setAnalyticsQueryDays(String(analyticsQueryRetentionSetting ?? 180));
    setAnalyticsAggregateDays(String(analyticsAggregateRetentionSetting ?? 730));
  }, [analyticsQueryRetentionSetting, analyticsAggregateRetentionSetting]);

  if (!overview) {
    return (
      <div className="ac-card" style={{ padding: 40, textAlign: 'center' }}>
        {loading ? <Spinner size={18} /> : <span className="ac-muted">Could not load settings.</span>}
      </div>
    );
  }

  const discoveryNext = overview.scheduler.jobs.find((job) => job.id === 'discovery')?.next_run;
  const reclaimNext = overview.scheduler.jobs.find((job) => job.id === 'reclaim')?.next_run;

  async function openRechunk() {
    setRechunkOpen(true);
    setRechunkText('');
    setRechunkInfo(null);
    try {
      const info = await api<{ queued: number; target_words: number }>(
        '/admin/episodes/rechunk?dry_run=true',
        { method: 'POST' },
      );
      setRechunkInfo(info);
    } catch (err) {
      admin.toast('Could not count affected episodes', 'error', { detail: (err as Error).message });
    }
  }

  return (
    <div className="ac-stack">
      <section className="ac-card">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><Server size={15} /></span>
          <h2>Pipeline</h2>
        </div>

        <div className="ac-list">
          <SettingToggle
            label="Auto discover"
            detail="Run scheduled discovery every six hours. Manual discovery always works."
            checked={overview.settings.auto_discover}
            pending={admin.isPending('setting:auto_discover')}
            onChange={(value) => admin.saveSettings({ auto_discover: value })}
          />
          <SettingToggle
            label="Auto download"
            detail="Dispatch newly discovered episodes to blurb automatically. Explicit admin actions bypass this."
            checked={overview.settings.auto_download}
            pending={admin.isPending('setting:auto_download')}
            onChange={(value) => admin.saveSettings({ auto_download: value })}
          />
        </div>

        <div className="ac-grid ac-grid-2" style={{ marginTop: 18 }}>
          <div className="ac-field">
            <span>Minimum episode duration (seconds)</span>
            <div className="ac-row">
              <input
                className="ac-input"
                type="number"
                min={0}
                step={60}
                value={minDur}
                onChange={(e) => setMinDur(e.target.value)}
                style={{ width: 130 }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                loading={admin.isPending('setting:min-duration')}
                onClick={() => admin.saveSettings({ min_episode_duration_seconds: Math.max(0, parseInt(minDur, 10) || 0) })}
              >
                Save
              </Button>
            </div>
            <span className="ac-tiny">
              Shorter episodes are auto-blacklisted at discovery. 0 disables the floor.
            </span>
          </div>

          <div className="ac-field">
            <span>Target words per search chunk</span>
            <div className="ac-row">
              <input
                className="ac-input"
                type="number"
                min={10}
                max={500}
                step={10}
                value={chunkWords}
                onChange={(e) => setChunkWords(e.target.value)}
                style={{ width: 130 }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                loading={admin.isPending('setting:chunk-words')}
                onClick={() =>
                  admin.saveSettings({ chunk_target_words: Math.max(10, parseInt(chunkWords, 10) || 50) })
                }
              >
                Save
              </Button>
            </div>
            <span className="ac-tiny">Applies to new transcriptions and re-chunking.</span>
          </div>
        </div>

        <div className="ac-grid ac-grid-2" style={{ marginTop: 18 }}>
          <div className="ac-field">
            <span>Job history retention (days)</span>
            <div className="ac-row">
              <input
                className="ac-input"
                type="number"
                min={0}
                step={1}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                style={{ width: 130 }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                loading={admin.isPending('setting:job_history_retention_days')}
                onClick={() =>
                  admin.saveSettings({
                    job_history_retention_days: Math.max(0, parseInt(retentionDays, 10) || 0),
                  })
                }
              >
                Save
              </Button>
            </div>
            <span className="ac-tiny">
              Finished jobs older than this are purged every 6 hours. 0 disables automatic cleanup.
            </span>
          </div>

          <div className="ac-field">
            <span>Discovery schedule (cron)</span>
            <div className="ac-row">
              <input
                className="ac-input ac-mono"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 */6 * * *"
                style={{ flex: 1 }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                loading={admin.isPending('setting:discovery_schedule')}
                onClick={() => admin.saveSettings({ discovery_schedule: schedule.trim() || '0 */6 * * *' })}
              >
                Save
              </Button>
            </div>
            <span className="ac-tiny">
              Five-field cron, evaluated in America/Los_Angeles. Invalid expressions fall back to every six hours.
            </span>
          </div>
        </div>
      </section>

      <section className="ac-card">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><BarChart3 size={15} /></span>
          <h2>Search analytics</h2>
        </div>

        <div className="ac-list">
          <SettingToggle
            label="Collect search analytics"
            detail="First-party, cookieless, aggregate-only. On by default; visitors can opt out with GPC/DNT or the control in the privacy policy."
            checked={overview.settings.analytics_enabled}
            pending={admin.isPending('setting:analytics_enabled')}
            onChange={(value) => admin.saveSettings({ analytics_enabled: value })}
          />
          <SettingToggle
            label="Store search text"
            detail="When off, searches are still counted but the query text is not saved. Podcast and clip aggregates are unaffected."
            checked={overview.settings.analytics_store_queries}
            pending={admin.isPending('setting:analytics_store_queries')}
            onChange={(value) => admin.saveSettings({ analytics_store_queries: value })}
          />
        </div>

        <div className="ac-grid ac-grid-2" style={{ marginTop: 18 }}>
          <div className="ac-field">
            <span>Query text retention (days)</span>
            <div className="ac-row">
              <input
                className="ac-input"
                type="number"
                min={0}
                step={1}
                value={analyticsQueryDays}
                onChange={(e) => setAnalyticsQueryDays(e.target.value)}
                style={{ width: 130 }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                loading={admin.isPending('setting:analytics_query_retention_days')}
                onClick={() =>
                  admin.saveSettings({
                    analytics_query_retention_days: Math.max(0, parseInt(analyticsQueryDays, 10) || 0),
                  })
                }
              >
                Save
              </Button>
            </div>
            <span className="ac-tiny">Search text older than this is purged daily. 0 keeps it indefinitely.</span>
          </div>

          <div className="ac-field">
            <span>Aggregate retention (days)</span>
            <div className="ac-row">
              <input
                className="ac-input"
                type="number"
                min={0}
                step={1}
                value={analyticsAggregateDays}
                onChange={(e) => setAnalyticsAggregateDays(e.target.value)}
                style={{ width: 130 }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                loading={admin.isPending('setting:analytics_aggregate_retention_days')}
                onClick={() =>
                  admin.saveSettings({
                    analytics_aggregate_retention_days: Math.max(0, parseInt(analyticsAggregateDays, 10) || 0),
                  })
                }
              >
                Save
              </Button>
            </div>
            <span className="ac-tiny">
              Daily totals, podcast, and clip aggregates. 0 keeps them indefinitely.
            </span>
          </div>
        </div>

        <div className="ac-tiny ac-subtle" style={{ marginTop: 10 }}>
          Days are counted in America/Los_Angeles. Query text is only stored when the related setting
          is on, and obvious PII is redacted before storage.
        </div>
      </section>

      <section className="ac-card">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><CalendarClock size={15} /></span>
          <h2>Scheduler</h2>
          <div className="ac-card-actions">
            <Button
              size="sm"
              variant={overview.scheduler.processing_paused ? 'success' : 'warning'}
              loading={admin.isPending('scheduler')}
              onClick={() => admin.schedulerAction(overview.scheduler.processing_paused ? 'resume' : 'pause')}
            >
              {overview.scheduler.processing_paused ? 'Resume processing' : 'Pause processing'}
            </Button>
          </div>
        </div>

        <div className="ac-grid ac-grid-3">
          <Info label="Processing" value={overview.scheduler.processing_paused ? 'Paused' : 'Running'} />
          <Info label="Next discovery" value={`${fmtRelative(discoveryNext)} (${fmtDateTime(discoveryNext)})`} />
          <Info label="Next reclaim sweep" value={`${fmtRelative(reclaimNext)} (${fmtDateTime(reclaimNext)})`} />
          <Info label="Last discovery" value={fmtRelative(overview.last_runs.discovery)} />
          <Info label="Last reclaim" value={fmtRelative(overview.last_runs.reclaim)} />
          <Info
            label="Consecutive failures"
            value={overview.scheduler.consecutive_failures ?? 0}
          />
        </div>
      </section>

      <section className="ac-card is-danger">
        <div className="ac-card-header">
          <span className="ac-card-header-icon"><AlertTriangle size={15} /></span>
          <h2 style={{ color: '#fca5a5' }}>Danger zone</h2>
        </div>

        <div className="ac-list">
          <div className="ac-list-item">
            <RotateCcw size={15} style={{ color: 'var(--ac-red)' }} />
            <div className="ac-list-item-main">
              <div className="ac-list-item-title">Re-chunk all episodes</div>
              <div className="ac-list-item-sub">
                Rebuilds every processed episode&apos;s search chunks from its stored transcript using the
                current chunk size. Search results are unavailable while it runs.
              </div>
            </div>
            <Button size="sm" variant="danger" onClick={openRechunk}>
              Re-chunk all
            </Button>
          </div>

          <div className="ac-list-item">
            <Database size={15} style={{ color: 'var(--ac-red)' }} />
            <div className="ac-list-item-main">
              <div className="ac-list-item-title">Clear finished job history</div>
              <div className="ac-list-item-sub">
                Deletes completed and failed job rows. Episodes, transcripts, and active jobs are untouched.
              </div>
            </div>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={12} />}
              onClick={() =>
                admin.confirm({
                  title: 'Clear finished job history?',
                  message: 'This permanently deletes all completed and failed job records.',
                  confirmLabel: 'Clear history',
                  tone: 'danger',
                  requireText: 'CLEAR',
                  onConfirm: async () => {
                    await admin.run('purge-jobs', async () => {
                      const result = await api<{ deleted: number }>('/admin/jobs/purge', {
                        method: 'POST',
                        body: JSON.stringify({}),
                      });
                      admin.toast(`Deleted ${result.deleted} job(s)`);
                      admin.refreshAll();
                    });
                  },
                })
              }
            >
              Clear
            </Button>
          </div>

          <div className="ac-list-item">
            <BarChart3 size={15} style={{ color: 'var(--ac-red)' }} />
            <div className="ac-list-item-main">
              <div className="ac-list-item-title">Clear analytics data</div>
              <div className="ac-list-item-sub">
                Deletes every search, query, podcast, and clip aggregate. This cannot be undone.
              </div>
            </div>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={12} />}
              onClick={() =>
                admin.confirm({
                  title: 'Clear all analytics data?',
                  message: 'This permanently deletes every analytics aggregate row.',
                  confirmLabel: 'Clear analytics',
                  tone: 'danger',
                  requireText: 'CLEAR',
                  onConfirm: async () => {
                    await admin.run('purge-analytics', async () => {
                      const result = await api<{ deleted: Record<string, number> }>('/admin/analytics', {
                        method: 'DELETE',
                      });
                      const total = Object.values(result.deleted).reduce((sum, value) => sum + value, 0);
                      admin.toast(`Deleted ${fmtNumber(total)} analytics row(s)`);
                      admin.refreshAll();
                    });
                  },
                })
              }
            >
              Clear
            </Button>
          </div>

          <div className="ac-list-item">
            <RefreshCw size={15} style={{ color: 'var(--ac-muted)' }} />
            <div className="ac-list-item-main">
              <div className="ac-list-item-title">Bust public caches</div>
              <div className="ac-list-item-sub">
                Forces the next public podcast/episode request to re-query the database. Admin actions
                normally do this automatically.
              </div>
            </div>
            <div className="ac-row">
              <Button
                size="sm"
                variant="ghost"
                loading={admin.isPending('bust-episodes')}
                onClick={() =>
                  admin.run('bust-episodes', async () => {
                    await api('/admin/episodes/cache/bust', { method: 'POST' });
                    admin.toast('Episode cache busted');
                  })
                }
              >
                Episodes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={admin.isPending('bust-podcasts')}
                onClick={() =>
                  admin.run('bust-podcasts', async () => {
                    await api('/admin/podcasts/cache/bust', { method: 'POST' });
                    admin.toast('Podcast cache busted');
                  })
                }
              >
                Podcasts
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={rechunkOpen}
        onClose={() => setRechunkOpen(false)}
        title="Re-chunk all episodes?"
        subtitle="This deletes and rebuilds every processed episode's search chunks."
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRechunkOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rechunkText !== 'RECHUNK' || !rechunkInfo}
              loading={admin.isPending('rechunk')}
              onClick={() =>
                admin.run('rechunk', async () => {
                  const result = await api<{ queued: number; target_words: number }>(
                    '/admin/episodes/rechunk',
                    { method: 'POST' },
                  );
                  admin.toast(`Re-chunking ${result.queued} episode(s)`, 'ok', {
                    detail: `${result.target_words} words per chunk`,
                  });
                  setRechunkOpen(false);
                  admin.refreshAll();
                })
              }
            >
              Re-chunk everything
            </Button>
          </>
        }
      >
        {!rechunkInfo ? (
          <div className="ac-row ac-muted">
            <Spinner /> Counting affected episodes…
          </div>
        ) : (
          <div className="ac-callout is-danger" style={{ marginBottom: 12 }}>
            <strong>{fmtNumber(rechunkInfo.queued)} processed episodes</strong> will have their chunks
            deleted and rebuilt at <strong>{rechunkInfo.target_words} words</strong> per chunk. Raw
            transcripts are preserved.
          </div>
        )}
        <label className="ac-field">
          <span>
            Type <code>RECHUNK</code> to confirm
          </span>
          <input
            className="ac-input"
            value={rechunkText}
            onChange={(e) => setRechunkText(e.target.value)}
            placeholder="RECHUNK"
            autoFocus
          />
        </label>
      </Modal>
    </div>
  );
}

function SettingToggle({
  label,
  detail,
  checked,
  pending,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  pending: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="ac-list-item">
      <div className="ac-list-item-main">
        <div className="ac-list-item-title">{label}</div>
        <div className="ac-list-item-sub">{detail}</div>
      </div>
      <Toggle checked={checked} disabled={pending} onChange={onChange} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="ac-tiny ac-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {label}
      </div>
      <div style={{ color: 'var(--ac-text-2)', fontSize: 12.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}
