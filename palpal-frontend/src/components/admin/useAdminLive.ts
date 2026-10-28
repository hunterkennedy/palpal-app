'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bumps } from './types';

const EMPTY_BUMPS: Bumps = {
  overview: 0,
  episodes: 0,
  jobs: 0,
  podcasts: 0,
  settings: 0,
  content: 0,
};

const TABLE_BUMPS: Record<string, Array<keyof Bumps>> = {
  episodes: ['episodes', 'overview'],
  jobs: ['jobs', 'overview', 'episodes'],
  job_events: ['jobs'],
  podcasts: ['podcasts', 'overview', 'episodes'],
  sources: ['podcasts', 'overview', 'episodes'],
  settings: ['settings', 'overview', 'content'],
  worker_heartbeats: ['overview'],
  whats_new: ['content'],
  admin_audit: ['overview'],
};

export type LiveState = 'connecting' | 'live' | 'reconnecting';

export function useAdminLive() {
  const [bumps, setBumps] = useState<Bumps>(EMPTY_BUMPS);
  const [liveState, setLiveState] = useState<LiveState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const connectedOnce = useRef(false);
  const disconnected = useRef(false);

  const applyTables = useCallback((tables: string[]) => {
    setBumps((prev) => {
      const next = { ...prev };
      const keys = new Set<keyof Bumps>();
      for (const table of tables) {
        const mapped = TABLE_BUMPS[table];
        if (mapped) {
          mapped.forEach((key) => keys.add(key));
        } else {
          (Object.keys(next) as Array<keyof Bumps>).forEach((key) => keys.add(key));
        }
      }
      keys.forEach((key) => {
        next[key] += 1;
      });
      return next;
    });
    setLastEventAt(Date.now());
  }, []);

  const bumpAll = useCallback(() => {
    setBumps((prev) => {
      const next = { ...prev };
      (Object.keys(next) as Array<keyof Bumps>).forEach((key) => {
        next[key] += 1;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    let closed = false;
    const source = new EventSource('/api/admin/stream');
    sourceRef.current = source;

    const onReady = () => {
      if (closed) return;
      setLiveState('live');
      // Refetch after a reconnection; the initial mount already fetched, so
      // don't immediately double every request on first connect.
      if (disconnected.current) {
        disconnected.current = false;
        bumpAll();
      }
      connectedOnce.current = true;
    };

    const onInvalidate = (event: MessageEvent<string>) => {
      if (closed) return;
      setLiveState('live');
      try {
        const payload = JSON.parse(event.data) as { tables?: string[] };
        applyTables(payload.tables ?? ['*']);
      } catch {
        applyTables(['*']);
      }
    };

    const onError = () => {
      if (closed) return;
      if (connectedOnce.current) disconnected.current = true;
      setLiveState('reconnecting');
    };

    source.addEventListener('ready', onReady);
    source.addEventListener('invalidate', onInvalidate as EventListener);
    source.onopen = () => {
      if (!closed) setLiveState('live');
    };
    source.onerror = onError;

    return () => {
      closed = true;
      source.close();
      sourceRef.current = null;
    };
  }, [applyTables, bumpAll]);

  // Safety net for SSE being blocked entirely (corporate proxy, browser
  // extension) or the conductor listener dying while the connection stays up.
  // The console still works; updates just arrive on a slower cadence.
  useEffect(() => {
    const interval = liveState === 'live' ? 60_000 : 10_000;
    const timer = window.setInterval(bumpAll, interval);
    return () => window.clearInterval(timer);
  }, [liveState, bumpAll]);

  return { bumps, liveState, lastEventAt, bumpAll };
}
