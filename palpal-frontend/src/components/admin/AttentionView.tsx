'use client';

import React from 'react';
import {
  AlertTriangle,
  Ban,
  Eye,
  RotateCcw,
  ShieldOff,
  ShieldCheck,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { AttentionData, AttentionEpisode } from './types';
import {
  Badge,
  Button,
  EmptyState,
  Spinner,
  fmtNumber,
  fmtRelative,
  titleCase,
} from './ui';

const SEVERITY_TONE: Record<string, string> = {
  high: 'red',
  medium: 'yellow',
  low: 'gray',
};

export default function AttentionView({
  data,
  loading,
  includeIgnored,
  onToggleIgnored,
  onOpenEpisode,
  onOpenEpisodes,
}: {
  data: AttentionData | null;
  loading: boolean;
  includeIgnored: boolean;
  onToggleIgnored: (next: boolean) => void;
  onOpenEpisode: (episode: AttentionEpisode) => void;
  onOpenEpisodes: () => void;
}) {
  const admin = useAdmin();

  if (!data) {
    return (
      <div className="ac-card" style={{ padding: 40, textAlign: 'center' }}>
        {loading ? <Spinner size={18} /> : <span className="ac-muted">Could not load attention inbox.</span>}
      </div>
    );
  }

  const active = data.groups.filter((group) => !group.ignored);
  const ignored = data.groups.filter((group) => group.ignored);

  const retry = (ids: string[]) => {
    void admin.bulkEpisodeAction('retry', ids);
  };

  const blacklist = (ids: string[], label: string) => {
    admin.confirm({
      title: `Blacklist ${label}?`,
      message: (
        <>
          Blacklist <strong>{fmtNumber(ids.length)} episodes</strong> in this group. They stay in the
          database but won't be retried or re-queued.
        </>
      ),
      confirmLabel: 'Blacklist group',
      tone: 'danger',
      onConfirm: async () => {
        await admin.bulkEpisodeAction('blacklist', ids);
      },
    });
  };

  const ignore = async (groupKey: string, ignoredNow: boolean) => {
    await admin.run(`attention-ignore:${groupKey}`, async () => {
      await api('/admin/attention/ignore', {
        method: 'POST',
        body: JSON.stringify({ category: groupKey, ignored: ignoredNow }),
      });
      admin.toast(ignoredNow ? 'Category ignored' : 'Category restored');
      admin.refreshAll();
    });
  };

  return (
    <div className="ac-stack">
      <div className="ac-row-between">
        <div className="ac-row">
          <Badge tone={data.total > 0 ? 'red' : 'green'}>
            {fmtNumber(data.total)} needing attention
          </Badge>
          <span className="ac-small ac-muted">
            {active.length} active group{active.length === 1 ? '' : 's'}
            {ignored.length ? ` · ${ignored.length} ignored` : ''}
          </span>
          {loading ? <Spinner /> : null}
        </div>
        <div className="ac-row">
          <Button size="sm" variant="ghost" onClick={onOpenEpisodes}>
            Browse all episodes
          </Button>
          <Button
            size="sm"
            variant={includeIgnored ? 'secondary' : 'ghost'}
            onClick={() => onToggleIgnored(!includeIgnored)}
          >
            {includeIgnored ? 'Hide ignored' : 'Show ignored'}
          </Button>
        </div>
      </div>

      {data.groups.length === 0 ? (
        <div className="ac-card">
          <EmptyState
            title="Nothing needs attention"
            detail="Failed and orphaned episodes will be grouped here by cause."
            action={
              <Button variant="secondary" size="sm" onClick={onOpenEpisodes}>
                Browse episodes
              </Button>
            }
          />
        </div>
      ) : (
        <div className="ac-grid ac-grid-2" style={{ alignItems: 'start' }}>
          {data.groups.map((group) => (
            <section className={`ac-card ${group.ignored ? 'is-flat' : ''}`} key={group.key}>
              <div className="ac-card-header" style={{ marginBottom: 10 }}>
                <span className="ac-card-header-icon" style={{ color: 'var(--ac-red)' }}>
                  {group.ignored ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ marginBottom: 2 }}>{group.label}</h2>
                  <div className="ac-tiny ac-subtle">{group.description}</div>
                </div>
                <div className="ac-card-actions">
                  <Badge tone={SEVERITY_TONE[group.severity] ?? 'gray'}>{group.severity}</Badge>
                  <Badge tone={group.ignored ? 'gray' : 'red'}>{fmtNumber(group.count)}</Badge>
                </div>
              </div>

              <div className="ac-row" style={{ marginBottom: 10 }}>
                {!group.ignored ? (
                  <>
                    {group.key !== 'orphaned' ? (
                      <Button
                        size="sm"
                        variant="warning"
                        icon={<RotateCcw size={12} />}
                        onClick={() => retry(group.episode_ids)}
                      >
                        Retry all
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Ban size={12} />}
                      onClick={() => blacklist(group.episode_ids, group.label)}
                    >
                      Blacklist all
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={group.ignored ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                  onClick={() => ignore(group.key, !group.ignored)}
                >
                  {group.ignored ? 'Restore' : 'Ignore group'}
                </Button>
              </div>

              <div className="ac-list">
                {group.episodes.map((episode) => (
                  <div
                    className="ac-list-item"
                    key={episode.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onOpenEpisode(episode)}
                  >
                    <span className={`ac-dot ${episode.status === 'failed' ? 'offline' : 'warn'}`} />
                    <div className="ac-list-item-main">
                      <div className="ac-list-item-title ac-truncate">{episode.title || '(untitled)'}</div>
                      <div className="ac-list-item-sub ac-truncate" title={episode.error_message ?? ''}>
                        {episode.podcast_name} · {titleCase(episode.status)}
                        {episode.error_message ? ` · ${episode.error_message}` : ''}
                      </div>
                    </div>
                    <span className="ac-tiny ac-subtle ac-nowrap">
                      {fmtRelative(episode.updated_at)}
                    </span>
                    <button
                      type="button"
                      className="ac-icon-btn"
                      title="Open episode"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenEpisode(episode);
                      }}
                    >
                      <Eye size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {group.count > group.episodes.length ? (
                <div className="ac-tiny ac-subtle" style={{ marginTop: 8 }}>
                  Showing {group.episodes.length} of {fmtNumber(group.count)}. Use the actions above to
                  handle the whole group.
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
