'use client';

import { createContext, useContext } from 'react';
import type { ConfirmRequest, ToastItem } from './ui';
import type { EpisodeFilters, ViewKey } from './types';

export interface ToastOptions {
  detail?: string;
  action?: ToastItem['action'];
}

export interface AdminApi {
  toast: (message: string, tone?: ToastItem['tone'], options?: ToastOptions) => void;
  confirm: (request: ConfirmRequest) => void;
  isPending: (key: string) => boolean;
  run: <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>;
  navigate: (view: ViewKey, options?: { episodeFilters?: Partial<EpisodeFilters>; podcastId?: string }) => void;
  refreshAll: () => void;
  episodeAction: (action: string, id: string) => Promise<boolean>;
  bulkEpisodeAction: (
    action: string,
    ids: string[],
    options?: { allMatching?: boolean; filter?: EpisodeFilters },
  ) => Promise<void>;
  jobAction: (action: 'cancel' | 'prioritize' | 'retry', id: string) => Promise<void>;
  schedulerAction: (action: 'pause' | 'resume') => Promise<void>;
  discover: (options: { podcast_id?: string; source_id?: string; auto_queue: boolean }) => Promise<void>;
  saveSettings: (patch: Record<string, boolean | number>) => Promise<void>;
}

export const AdminContext = createContext<AdminApi | null>(null);

export function useAdmin(): AdminApi {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside AdminContext.Provider');
  return ctx;
}
