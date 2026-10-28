'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from './api';
import type { AdminSearchResults } from './types';
import { KeyHint } from './ui';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette({
  open,
  items,
  onClose,
  onOpenEpisode,
  onOpenPodcast,
  onOpenJob,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
  onOpenEpisode: (episodeId: string) => void;
  onOpenPodcast: (podcastId: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remoteItems, setRemoteItems] = useState<CommandItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setRemoteItems([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemoteItems([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await api<AdminSearchResults>(
          `/admin/search?q=${encodeURIComponent(q)}&limit=6`,
        );
        if (cancelled) return;
        setRemoteItems([
          ...results.episodes.map((episode) => ({
            id: `episode:${episode.id}`,
            label: episode.title || '(untitled)',
            group: 'Episodes',
            hint: `${episode.podcast_name} · ${episode.status}`,
            run: () => onOpenEpisode(episode.id),
          })),
          ...results.podcasts.map((podcast) => ({
            id: `podcast:${podcast.id}`,
            label: podcast.display_name,
            group: 'Podcasts',
            hint: podcast.enabled ? 'enabled' : 'disabled',
            run: () => onOpenPodcast(podcast.id),
          })),
          ...results.jobs.map((job) => ({
            id: `job:${job.id}`,
            label: job.episode_title || job.source_name || job.id.slice(0, 8),
            group: 'Jobs',
            hint: `${job.kind} · ${job.status}`,
            run: () => onOpenJob(job.id),
          })),
        ]);
      } catch {
        if (!cancelled) setRemoteItems([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, onOpenEpisode, onOpenPodcast, onOpenJob]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = q
      ? items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.group.toLowerCase().includes(q) ||
            (item.hint ?? '').toLowerCase().includes(q),
        )
      : items;
    return q ? [...local, ...remoteItems] : local;
  }, [items, remoteItems, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((prev) => Math.min(filtered.length - 1, prev + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((prev) => Math.max(0, prev - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = filtered[active];
        if (item) {
          item.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onClose]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div className="ac-command-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ac-command" role="dialog" aria-modal>
        <div className="ac-command-input">
          <Search size={15} className="ac-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page, episode, podcast, or job…"
          />
          {searching ? <span className="ac-tiny ac-subtle">searching…</span> : <KeyHint>esc</KeyHint>}
        </div>
        <div className="ac-command-list">
          {filtered.length === 0 ? (
            <div className="ac-empty" style={{ padding: 24 }}>
              Nothing matches.
            </div>
          ) : (
            filtered.map((item, index) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <React.Fragment key={item.id}>
                  {showGroup ? <div className="ac-command-group">{item.group}</div> : null}
                  <button
                    className={`ac-command-item ${index === active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.hint ? <span className="ac-command-hint">{item.hint}</span> : null}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
