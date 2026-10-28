'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Edit3,
  FlaskConical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAdmin } from './AdminContext';
import { api } from './api';
import type { Podcast, Source } from './types';
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Spinner,
  Toggle,
  fmtDateTime,
  fmtNumber,
  fmtRelative,
} from './ui';

interface SourceForm {
  id: string | null;
  name: string;
  site: string;
  url: string;
  exclude: string;
  enabled: boolean;
}

const EMPTY_SOURCE: SourceForm = {
  id: null,
  name: '',
  site: 'youtube',
  url: '',
  exclude: '',
  enabled: true,
};

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function PodcastsView({
  podcasts,
  selectedId,
  onSelect,
  loading,
  onOpenEpisodes,
  onOpenJob,
}: {
  podcasts: Podcast[] | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  loading: boolean;
  onOpenEpisodes: (podcastId: string, status: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const admin = useAdmin();
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPod, setNewPod] = useState({ name: '', id: '', enabled: true });

  const selected = useMemo(
    () => podcasts?.find((p) => p.id === selectedId) ?? null,
    [podcasts, selectedId],
  );

  useEffect(() => {
    if (!selectedId && podcasts?.length) {
      onSelect(podcasts[0].id);
    }
  }, [selectedId, podcasts, onSelect]);

  const selectedIdValue = selected?.id;
  const selectedNameValue = selected?.display_name;

  useEffect(() => {
    if (!selectedIdValue) return;
    setName(selectedNameValue ?? '');
    setNameDirty(false);
    setEditingSource(null);
  }, [selectedIdValue, selectedNameValue]);

  const filtered = useMemo(() => {
    if (!podcasts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return podcasts;
    return podcasts.filter(
      (p) => p.display_name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [podcasts, search]);

  const index = podcasts?.findIndex((p) => p.id === selectedId) ?? -1;

  async function patchPodcast(patch: Record<string, unknown>, key: string) {
    if (!selected) return;
    await admin.run(key, async () => {
      await api(`/admin/podcasts/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          display_name: selected.display_name,
          enabled: selected.enabled,
          display_order: selected.display_order,
          ...patch,
        }),
      });
      admin.toast('Podcast saved');
      admin.refreshAll();
    });
  }

  async function move(delta: number) {
    if (!podcasts || !selected || index < 0) return;
    const next = [...podcasts];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await admin.run('podcast-order', async () => {
      await api('/admin/podcasts/order', {
        method: 'PUT',
        body: JSON.stringify({ ids: next.map((p) => p.id) }),
      });
      admin.toast('Order saved');
      admin.refreshAll();
    });
  }

  function startEditSource(source: Source) {
    setEditingSource({
      id: source.id,
      name: source.name,
      site: source.site,
      url: source.url,
      exclude: (source.filters?.title_exclude ?? []).join(', '),
      enabled: source.enabled,
    });
  }

  async function saveSource() {
    if (!selected || !editingSource) return;
    const form = editingSource;
    if (!form.name.trim() || !form.url.trim()) {
      admin.toast('Source name and URL are required', 'error');
      return;
    }
    const filters: Record<string, unknown> = {};
    const exclude = form.exclude
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (exclude.length) filters.title_exclude = exclude;

    const body = {
      name: form.name.trim(),
      site: form.site,
      url: form.url.trim(),
      enabled: form.enabled,
      filters,
    };

    await admin.run(`source-save:${form.id ?? 'new'}`, async () => {
      if (form.id) {
        await api(`/admin/sources/${form.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api(`/admin/podcasts/${selected.id}/sources`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      admin.toast(form.id ? 'Source updated' : 'Source added');
      setEditingSource(null);
      admin.refreshAll();
    });
  }

  async function toggleSource(source: Source, enabled: boolean) {
    await admin.run(`source-toggle:${source.id}`, async () => {
      await api(`/admin/sources/${source.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: source.name,
          site: source.site,
          url: source.url,
          enabled,
          filters: source.filters ?? {},
        }),
      });
      admin.toast(enabled ? 'Source enabled' : 'Source disabled');
      admin.refreshAll();
    });
  }

  async function testSource(source: Source) {
    await admin.run(`test-source:${source.id}`, async () => {
      const result = await api<{ job_id: string }>(`/admin/sources/${source.id}/test`, {
        method: 'POST',
      });
      admin.toast('Dry-run discovery queued', 'ok', {
        detail: `Job ${result.job_id.slice(0, 8)} — no changes will be applied`,
      });
      onOpenJob(result.job_id);
      admin.refreshAll();
    });
  }

  async function createPodcast() {
    const nameValue = newPod.name.trim();
    if (!nameValue) {
      admin.toast('Podcast name is required', 'error');
      return;
    }
    const id = (newPod.id || toSlug(nameValue)).trim();
    await admin.run('podcast-create', async () => {
      await api('/admin/podcasts', {
        method: 'POST',
        body: JSON.stringify({
          id,
          display_name: nameValue,
          enabled: newPod.enabled,
          display_order: podcasts?.length ?? 0,
        }),
      });
      admin.toast('Podcast created');
      setCreating(false);
      setNewPod({ name: '', id: '', enabled: true });
      admin.refreshAll();
      onSelect(id);
    });
  }

  return (
    <div className="ac-split">
      <section className="ac-card" style={{ padding: 12 }}>
        <div className="ac-row-between" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--ac-muted)', margin: 0 }}>
            Podcasts
          </h2>
          <Button size="sm" variant="secondary" icon={<Plus size={12} />} onClick={() => setCreating(true)}>
            New
          </Button>
        </div>

        <div className="ac-search" style={{ maxWidth: 'none', marginBottom: 9 }}>
          <Search size={14} />
          <input
            className="ac-input"
            placeholder="Find a podcast…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && !podcasts ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spinner size={16} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No podcasts" detail="Create one to start adding sources." />
        ) : (
          <div className="ac-pod-list">
            {filtered.map((pod) => {
              const problems = (pod.failed ?? 0) + (pod.orphaned ?? 0);
              return (
                <button
                  key={pod.id}
                  className={`ac-pod-item ${pod.id === selectedId ? 'is-active' : ''} ${!pod.enabled ? 'is-disabled' : ''}`}
                  onClick={() => onSelect(pod.id)}
                >
                  <span className={`ac-dot ${pod.enabled ? 'online' : ''}`} />
                  <span className="ac-truncate">{pod.display_name}</span>
                  {problems > 0 ? <Badge tone="red">{problems}</Badge> : null}
                  <span className="ac-pod-meta">{fmtNumber(pod.total)}</span>
                  <ChevronRight size={12} className="ac-subtle" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="ac-card">
        {!selected ? (
          <EmptyState
            title="Select a podcast"
            detail="Edit metadata, manage sources, or reorder podcasts from here."
            action={
              <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => setCreating(true)}>
                New podcast
              </Button>
            }
          />
        ) : (
          <>
            <div className="ac-card-header" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="ac-row" style={{ gap: 8 }}>
                  <input
                    className="ac-input"
                    value={name}
                    style={{ fontSize: 14, fontWeight: 600, minWidth: 220 }}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameDirty(e.target.value !== selected.display_name);
                    }}
                  />
                  {nameDirty ? (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={admin.isPending(`podcast-save:${selected.id}`)}
                      onClick={async () => {
                        await patchPodcast({ display_name: name.trim() || selected.display_name }, `podcast-save:${selected.id}`);
                        setNameDirty(false);
                      }}
                    >
                      Save
                    </Button>
                  ) : null}
                  {nameDirty ? (
                    <button
                      className="ac-icon-btn"
                      title="Discard"
                      onClick={() => {
                        setName(selected.display_name);
                        setNameDirty(false);
                      }}
                    >
                      <X size={13} />
                    </button>
                  ) : null}
                </div>
                <div className="ac-tiny ac-subtle" style={{ marginTop: 4 }}>
                  slug <span className="ac-mono">{selected.id}</span> · {fmtNumber(selected.source_count)} source(s)
                </div>
              </div>
              <div className="ac-card-actions">
                <Toggle
                  checked={selected.enabled}
                  label="Enabled"
                  disabled={admin.isPending(`podcast-toggle:${selected.id}`)}
                  onChange={(enabled) => patchPodcast({ enabled }, `podcast-toggle:${selected.id}`)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ArrowUp size={12} />}
                  disabled={index <= 0}
                  loading={admin.isPending('podcast-order')}
                  onClick={() => move(-1)}
                  title="Move up"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ArrowDown size={12} />}
                  disabled={!podcasts || index < 0 || index >= podcasts.length - 1}
                  loading={admin.isPending('podcast-order')}
                  onClick={() => move(1)}
                  title="Move down"
                />
              </div>
            </div>

            <div className="ac-grid ac-grid-5" style={{ marginBottom: 14 }}>
              <MiniStat label="total" value={selected.total} onClick={() => onOpenEpisodes(selected.id, 'all')} />
              <MiniStat label="queued" value={selected.discovered} onClick={() => onOpenEpisodes(selected.id, 'discovered')} />
              <MiniStat label="in flight" value={selected.downloading} onClick={() => onOpenEpisodes(selected.id, 'downloading')} />
              <MiniStat label="processed" value={selected.processed} onClick={() => onOpenEpisodes(selected.id, 'processed')} />
              <MiniStat
                label="problems"
                value={(selected.failed ?? 0) + (selected.orphaned ?? 0)}
                tone={(selected.failed ?? 0) + (selected.orphaned ?? 0) > 0 ? 'red' : undefined}
                onClick={() => onOpenEpisodes(selected.id, 'attention')}
              />
            </div>

            <div className="ac-row" style={{ marginBottom: 12 }}>
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={12} />}
                loading={admin.isPending(`discover:${selected.id}`)}
                onClick={() => admin.discover({ podcast_id: selected.id, auto_queue: true })}
              >
                Discover + queue
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={12} />}
                loading={admin.isPending(`discover-review:${selected.id}`)}
                onClick={() => admin.discover({ podcast_id: selected.id, auto_queue: false })}
              >
                Discover only
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={12} />}
                className="ac-row-end"
                onClick={() =>
                  admin.confirm({
                    title: `Delete ${selected.display_name}?`,
                    message: (
                      <>
                        This permanently deletes the podcast, all {fmtNumber(selected.source_count)} of its
                        sources, and every episode under them ({fmtNumber(selected.total)} episodes). Search
                        chunks and stored transcripts are removed too.
                      </>
                    ),
                    confirmLabel: 'Delete podcast',
                    tone: 'danger',
                    requireText: selected.id,
                    onConfirm: async () => {
                      await admin.run(`podcast-delete:${selected.id}`, async () => {
                        await api(`/admin/podcasts/${selected.id}`, { method: 'DELETE' });
                        admin.toast('Podcast deleted');
                        onSelect(null);
                        admin.refreshAll();
                      });
                    },
                  })
                }
              >
                Delete podcast
              </Button>
            </div>

            <div className="ac-row-between" style={{ marginBottom: 8 }}>
              <div className="ac-row" style={{ gap: 8 }}>
                <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--ac-muted)', margin: 0 }}>
                  Sources
                </h2>
                <Badge tone="gray">{selected.sources.length}</Badge>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={12} />}
                onClick={() => setEditingSource({ ...EMPTY_SOURCE })}
              >
                Add source
              </Button>
            </div>

            {selected.sources.length === 0 ? (
              <div className="ac-callout">
                No sources yet. Add a YouTube channel/playlist, Patreon collection, or RSS feed.
              </div>
            ) : (
              <div>
                {selected.sources.map((source) => {
                  const editing = editingSource?.id === source.id;
                  const problems = source.problems ?? 0;
                  return (
                    <div className="ac-source" key={source.id}>
                      <div className="ac-source-head">
                        <Badge tone={source.site === 'youtube' ? 'red' : source.site === 'patreon' ? 'orange' : 'purple'}>
                          {source.site}
                        </Badge>
                        <span className="ac-source-name">{source.name}</span>
                        {!source.enabled ? <Badge tone="gray">disabled</Badge> : null}
                        {source.last_discover_status === 'failed' ? (
                          <Badge tone="red" title={source.last_discover_error ?? ''}>
                            discovery failed
                          </Badge>
                        ) : null}
                        {source.last_discover_status === 'pending' || source.last_discover_status === 'claimed' ? (
                          <Badge tone="blue">discovering</Badge>
                        ) : null}
                        {problems > 0 ? <Badge tone="red">{problems} problems</Badge> : null}
                        <div className="ac-row-end ac-row" style={{ gap: 4 }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<FlaskConical size={11} />}
                            loading={admin.isPending(`test-source:${source.id}`)}
                            onClick={() => testSource(source)}
                            title="Scrape this source without applying any changes"
                          >
                            test
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<RefreshCw size={11} />}
                            loading={admin.isPending(`discover:source:${source.id}`)}
                            onClick={() =>
                              admin.discover({ source_id: source.id, auto_queue: true })
                            }
                          >
                            discover
                          </Button>
                          <button className="ac-icon-btn" title="Edit source" onClick={() => startEditSource(source)}>
                            <Edit3 size={13} />
                          </button>
                          <button
                            className="ac-icon-btn is-danger"
                            title="Delete source"
                            onClick={() =>
                              admin.confirm({
                                title: `Delete source "${source.name}"?`,
                                message: `This deletes the source and all ${fmtNumber(source.episode_count)} episodes discovered from it.`,
                                confirmLabel: 'Delete source',
                                tone: 'danger',
                                onConfirm: async () => {
                                  await admin.run(`source-delete:${source.id}`, async () => {
                                    await api(`/admin/sources/${source.id}`, { method: 'DELETE' });
                                    admin.toast('Source deleted');
                                    if (editingSource?.id === source.id) setEditingSource(null);
                                    admin.refreshAll();
                                  });
                                },
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="ac-source-url" title={source.url}>
                        {source.url}
                      </div>
                      {source.last_discover_status === 'failed' && source.last_discover_error ? (
                        <div className="ac-row-sub is-error" style={{ maxWidth: '100%', marginTop: 3 }}>
                          {source.last_discover_error}
                        </div>
                      ) : null}
                      <div className="ac-source-stats">
                        <span>{fmtNumber(source.episode_count)} episodes</span>
                        <span>{fmtNumber(source.processed)} processed</span>
                        <span>
                          last discovery{' '}
                          {source.last_discover_at ? (
                            <span title={fmtDateTime(source.last_discover_at)}>
                              {fmtRelative(source.last_discover_at)} · {source.last_discover_status || 'unknown'}
                            </span>
                          ) : (
                            'never'
                          )}
                        </span>
                        <span className="ac-row-end">
                          enabled
                          <Toggle
                            checked={source.enabled}
                            disabled={admin.isPending(`source-toggle:${source.id}`)}
                            onChange={(enabled) => toggleSource(source, enabled)}
                          />
                        </span>
                      </div>

                      {editing && editingSource ? (
                        <div className="ac-source-edit">
                          <div className="ac-form-grid">
                            <label className="ac-field">
                              <span>Name</span>
                              <input
                                className="ac-input"
                                value={editingSource.name}
                                onChange={(e) => setEditingSource({ ...editingSource, name: e.target.value })}
                                placeholder="Main channel"
                              />
                            </label>
                            <label className="ac-field">
                              <span>Site</span>
                              <select
                                className="ac-select"
                                value={editingSource.site}
                                onChange={(e) => setEditingSource({ ...editingSource, site: e.target.value })}
                              >
                                <option value="youtube">YouTube</option>
                                <option value="patreon">Patreon</option>
                                <option value="rss">RSS</option>
                              </select>
                            </label>
                            <label className="ac-field is-wide">
                              <span>URL</span>
                              <input
                                className="ac-input"
                                value={editingSource.url}
                                onChange={(e) => setEditingSource({ ...editingSource, url: e.target.value })}
                                placeholder="Channel/collection URL, or full RSS feed URL"
                              />
                            </label>
                            <label className="ac-field is-wide">
                              <span>Exclude titles (comma-separated)</span>
                              <input
                                className="ac-input"
                                value={editingSource.exclude}
                                onChange={(e) => setEditingSource({ ...editingSource, exclude: e.target.value })}
                                placeholder="clip, short, bonus"
                              />
                            </label>
                          </div>
                          <div className="ac-row">
                            <span className="ac-tiny ac-muted">Enabled</span>
                            <Toggle
                              checked={editingSource.enabled}
                              onChange={(enabled) => setEditingSource({ ...editingSource, enabled })}
                            />
                            <div className="ac-row-end ac-row">
                              <Button size="sm" variant="ghost" onClick={() => setEditingSource(null)}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                loading={admin.isPending(`source-save:${editingSource.id ?? 'new'}`)}
                                onClick={saveSource}
                              >
                                {editingSource.id ? 'Save source' : 'Add source'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {editingSource && editingSource.id === null ? (
              <div className="ac-source" style={{ marginTop: 8 }}>
                <div className="ac-source-edit" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
                  <div className="ac-form-grid">
                    <label className="ac-field">
                      <span>Source name</span>
                      <input
                        className="ac-input"
                        value={editingSource.name}
                        onChange={(e) => setEditingSource({ ...editingSource, name: e.target.value })}
                        placeholder="Main channel"
                        autoFocus
                      />
                    </label>
                    <label className="ac-field">
                      <span>Site</span>
                      <select
                        className="ac-select"
                        value={editingSource.site}
                        onChange={(e) => setEditingSource({ ...editingSource, site: e.target.value })}
                      >
                        <option value="youtube">YouTube</option>
                        <option value="patreon">Patreon</option>
                        <option value="rss">RSS</option>
                      </select>
                    </label>
                    <label className="ac-field is-wide">
                      <span>URL</span>
                      <input
                        className="ac-input"
                        value={editingSource.url}
                        onChange={(e) => setEditingSource({ ...editingSource, url: e.target.value })}
                        placeholder="Channel/collection URL, or full RSS feed URL"
                      />
                    </label>
                    <label className="ac-field is-wide">
                      <span>Exclude titles (comma-separated)</span>
                      <input
                        className="ac-input"
                        value={editingSource.exclude}
                        onChange={(e) => setEditingSource({ ...editingSource, exclude: e.target.value })}
                        placeholder="clip, short, bonus"
                      />
                    </label>
                  </div>
                  <div className="ac-row">
                    <span className="ac-tiny ac-muted">Enabled</span>
                    <Toggle
                      checked={editingSource.enabled}
                      onChange={(enabled) => setEditingSource({ ...editingSource, enabled })}
                    />
                    <div className="ac-row-end ac-row">
                      <Button size="sm" variant="ghost" onClick={() => setEditingSource(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={admin.isPending('source-save:new')}
                        onClick={saveSource}
                      >
                        Add source
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New podcast"
        subtitle="A slug is generated from the name; it is used in URLs and cannot be changed later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={admin.isPending('podcast-create')} onClick={createPodcast}>
              Create podcast
            </Button>
          </>
        }
      >
        <div className="ac-form-grid">
          <label className="ac-field is-wide">
            <span>Display name</span>
            <input
              className="ac-input"
              value={newPod.name}
              autoFocus
              onChange={(e) => {
                const nameValue = e.target.value;
                setNewPod((prev) => ({
                  ...prev,
                  name: nameValue,
                  id: prev.id && prev.id !== toSlug(prev.name) ? prev.id : toSlug(nameValue),
                }));
              }}
              placeholder="My Podcast"
            />
          </label>
          <label className="ac-field is-wide">
            <span>Slug</span>
            <input
              className="ac-input ac-mono"
              value={newPod.id}
              onChange={(e) => setNewPod({ ...newPod, id: toSlug(e.target.value) })}
              placeholder="my-podcast"
            />
          </label>
          <div className="ac-row">
            <Toggle checked={newPod.enabled} onChange={(enabled) => setNewPod({ ...newPod, enabled })} />
            <span className="ac-small ac-muted">Enabled</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="ac-stat is-clickable"
      style={{ padding: '8px 10px' }}
      onClick={onClick}
    >
      <span className={`ac-stat-value ${tone === 'red' ? 'ac-danger-text' : ''}`} style={{ fontSize: 17 }}>
        {fmtNumber(value)}
      </span>
      <span className="ac-stat-label">{label}</span>
    </button>
  );
}
