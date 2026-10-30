/**
 * First-party, cookieless analytics beacons.
 *
 * These functions are intentionally fire-and-forget: analytics must never
 * delay or break search. They also respect GPC/DNT and a per-browser opt-out
 * flag stored in localStorage.
 */

const OPTOUT_KEY = 'palpal_analytics_optout';

export interface SearchAnalyticsEvent {
  query: string;
  result_count: number;
  podcast_filter: string | null;
  top_podcast_ids: string[];
  corrected: boolean;
}

export interface OpenAnalyticsEvent {
  podcast_id: string;
  episode_id: string | null;
  chunk_id: string | null;
  source_site: string | null;
}

/** Whether the browser itself is sending GPC or DNT. */
export function hasBrowserPrivacySignal(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return (
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === '1' ||
    nav.doNotTrack === 'yes'
  );
}

/** The per-browser opt-out choice stored by palpal. */
export function getAnalyticsOptOutPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(OPTOUT_KEY) === '1';
  } catch {
    // localStorage may be unavailable (private mode, blocked storage).
    return false;
  }
}

function hasOptedOut(): boolean {
  if (typeof window === 'undefined') return true;
  return hasBrowserPrivacySignal() || getAnalyticsOptOutPreference();
}

function send(path: string, payload: unknown, preferBeacon: boolean): void {
  if (hasOptedOut()) return;

  const body = JSON.stringify(payload);

  try {
    if (
      preferBeacon &&
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(path, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    void fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
      cache: 'no-store',
    }).catch(() => {
      // Analytics failures are intentionally silent.
    });
  } catch {
    // Analytics failures are intentionally silent.
  }
}

export function trackSearch(event: SearchAnalyticsEvent): void {
  send('/api/analytics/search', event, false);
}

export function trackOpen(event: OpenAnalyticsEvent): void {
  send('/api/analytics/open', event, true);
}

/** Whether analytics is disabled for this browser. */
export function isAnalyticsOptedOut(): boolean {
  return hasOptedOut();
}

/** Persist the per-browser analytics opt-out choice. */
export function setAnalyticsOptOut(optedOut: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (optedOut) {
      window.localStorage.setItem(OPTOUT_KEY, '1');
    } else {
      window.localStorage.removeItem(OPTOUT_KEY);
    }
  } catch {
    // If storage is unavailable, the server-side GPC/DNT checks still apply.
  }
}
