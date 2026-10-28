export type ViewKey =
  | 'overview'
  | 'attention'
  | 'episodes'
  | 'jobs'
  | 'podcasts'
  | 'content'
  | 'audit'
  | 'settings';

export interface JobProgress {
  stage?: string;
  percent?: number;
  detail?: string;
}

export interface JobEvent {
  id: number;
  created_at: string;
  level: 'info' | 'progress' | 'warning' | 'error';
  stage?: string | null;
  percent?: number | null;
  message: string;
}

export interface Job {
  id: string;
  kind: 'discover' | 'process';
  status: 'pending' | 'claimed' | 'completed' | 'failed';
  claimed_by_worker?: string | null;
  claimed_at?: string | null;
  created_at: string;
  finished_at?: string | null;
  progress_at?: string | null;
  attempts?: number;
  priority?: number;
  progress?: JobProgress;
  error?: string | null;
  error_type?: string | null;
  episode_id?: string | null;
  episode_title?: string | null;
  episode_podcast?: string | null;
  source_id?: string | null;
  source_name?: string | null;
  source_podcast?: string | null;
  payload?: Record<string, unknown>;
  has_result?: boolean;
  events?: JobEvent[];
  dry_run_result?: {
    dry_run: boolean;
    entry_count: number;
    would_import: number;
    already_known: number;
    title_excluded: number;
    unavailable: number;
    too_short: number;
    would_orphan: number;
    title_exclude?: string[];
    min_duration_seconds?: number;
    sample?: Array<{
      video_id: string;
      title: string;
      pub_date?: string | null;
      duration?: number | null;
    }>;
  } | null;
}

export interface Episode {
  id: string;
  video_id: string;
  title: string;
  publication_date?: string | null;
  status: string;
  error_message?: string | null;
  blacklisted: boolean;
  podcast_id: string;
  podcast_name: string;
  source_name: string;
  site: 'youtube' | 'patreon' | 'rss' | string;
  duration_seconds?: number | null;
  youtube_url: string;
  created_at?: string | null;
  updated_at?: string | null;
  active_job?: Job | null;
}

export interface EpisodePage {
  episodes: Episode[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<string, number>;
}

export interface EpisodeDetail {
  episode: Episode & {
    source_id: string;
    chunk_count: number;
    word_count: number;
    first_chunk_at?: number | null;
    last_chunk_at?: number | null;
  };
  jobs: Job[];
  index: EpisodeIndex;
}

export interface EpisodeIndex {
  chunk_count: number;
  word_count: number;
  coverage_seconds: number;
  first_chunk_at: number;
  last_chunk_at: number;
  max_gap_seconds: number;
  empty_chunks: number;
  short_transcript: boolean;
  expected_duration_seconds?: number | null;
  chunks: Array<{
    chunk_index: number;
    start_time: number;
    end_time: number;
    word_count: number;
    text: string;
  }>;
}

export interface Worker {
  worker_id: string;
  last_seen_at: string;
  online: boolean;
  state?: string | null;
  stage?: string | null;
  job_id?: string | null;
  detail?: string | null;
  progress?: JobProgress;
  health?: {
    yt_dlp_version?: string | null;
    python_version?: string | null;
    platform?: string | null;
    gpu?: string | null;
    whisper_model?: string | null;
    whisper_device?: string | null;
    whisper_compute_type?: string | null;
    cookies?: Record<
      string,
      {
        configured: boolean;
        exists: boolean;
        filename?: string | null;
        expires_in_days?: number | null;
      }
    >;
  };
}

export interface SchedulerJob {
  id: string;
  next_run?: string | null;
}

export interface SchedulerStatus {
  running: boolean;
  processing_paused: boolean;
  consecutive_failures?: number;
  jobs: SchedulerJob[];
  dispatch?: { active: number; capacity: number };
}

export interface PodcastStats {
  id: string;
  display_name: string;
  enabled: boolean;
  display_order: number;
  priority: number;
  total: number;
  discovered: number;
  downloading: number;
  processed: number;
  failed: number;
  orphaned: number;
  blacklisted: number;
}

export interface Source {
  id: string;
  podcast_id?: string;
  name: string;
  site: 'youtube' | 'patreon' | 'rss' | string;
  url: string;
  enabled: boolean;
  filters: { title_exclude?: string[]; [key: string]: unknown };
  episode_count: number;
  processed: number;
  problems: number;
  last_discover_status?: string | null;
  last_discover_at?: string | null;
  last_discover_error?: string | null;
}

export interface Podcast extends PodcastStats {
  source_count: number;
  sources: Source[];
}

export interface PipelineSettings {
  auto_discover: boolean;
  auto_download: boolean;
  min_episode_duration_seconds: number;
  chunk_target_words: number;
  job_history_retention_days: number;
  discovery_schedule: string;
  [key: string]: unknown;
}

export interface Overview {
  scheduler: SchedulerStatus;
  blurb: { connected: boolean; workers: Worker[] };
  settings: PipelineSettings;
  counts: {
    total: number;
    discovered: number;
    downloading: number;
    processed: number;
    failed: number;
    orphaned: number;
    blacklisted: number;
    blacklisted_flag: number;
    attention: number;
  };
  podcasts: PodcastStats[];
  jobs: {
    counts: Record<string, number>;
    active_total: number;
    active: Job[];
    recent_failures: Job[];
    failed_24h: number;
  };
  throughput: {
    completed_24h: number;
    process_completed_7d: number;
    avg_process_seconds?: number | null;
    avg_discover_seconds?: number | null;
    jobs_per_hour: number;
    workers_online: number;
    queue_eta_seconds?: number | null;
    by_site: Array<{ site: string; count: number; avg_seconds?: number | null }>;
  };
  last_runs: { discovery?: string | null; reclaim?: string | null };
  generated_at: string;
}

export interface JobsPage {
  active: Job[];
  active_total: number;
  page: number;
  page_size: number;
  counts: Record<string, number>;
}

export interface JobHistoryPage {
  jobs: Job[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<string, number>;
}

export interface WhatsNewEntry {
  id: number;
  content: string;
  posted_at: string;
}

export interface AttentionEpisode {
  id: string;
  title: string;
  status: string;
  error_message?: string | null;
  site: string;
  podcast_id: string;
  podcast_name: string;
  source_name: string;
  updated_at?: string | null;
  blacklisted: boolean;
}

export interface AttentionGroup {
  key: string;
  label: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  ignored: boolean;
  count: number;
  episode_ids: string[];
  episodes: AttentionEpisode[];
}

export interface AttentionData {
  groups: AttentionGroup[];
  ignored_keys: string[];
  total: number;
  total_all: number;
}

export interface AdminSearchResults {
  episodes: Array<{
    id: string;
    title: string;
    status: string;
    site: string;
    podcast_name: string;
  }>;
  podcasts: Array<{
    id: string;
    display_name: string;
    enabled: boolean;
  }>;
  jobs: Array<{
    id: string;
    kind: string;
    status: string;
    error?: string | null;
    episode_title?: string | null;
    source_name?: string | null;
  }>;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  detail: Record<string, unknown>;
  undoable: boolean;
  undone_at?: string | null;
}

export interface EpisodeFilters {
  status: string;
  q: string;
  podcastId: string;
  site: string;
  sort: string;
  page: number;
  pageSize: number;
}

export interface JobHistoryFilters {
  status: string;
  kind: string;
  q: string;
  page: number;
  pageSize: number;
}

export interface Bumps {
  overview: number;
  episodes: number;
  jobs: number;
  podcasts: number;
  settings: number;
  content: number;
}

export interface ActionResult {
  queued: number;
  total: number;
  results?: Array<{ id: string; ok: boolean; detail?: string }>;
}
