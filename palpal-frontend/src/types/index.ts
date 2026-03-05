export interface TranscriptDocument {
  // Unique identifiers
  id: string;

  // Content
  text: string;
  word_count: number;

  // Podcast metadata
  podcast_id: string;
  podcast_name: string;
  source_name: string;

  // Episode metadata
  episode_id: string;
  episode_title: string;
  video_id: string;
  publication_date?: string | null;

  // Timing data
  start_time: number;
  end_time: number;
  duration: number;
  chunk_index: number;
  start_formatted: string;
  end_formatted: string;
  start_minutes: number;
}

export interface SearchHit extends TranscriptDocument {
  rank?: number;
  text_highlighted?: string;
  title_highlighted?: string;
}

export interface ErrorState {
  type: 'connection' | 'no_results' | 'rate_limit' | 'invalid_input' | 'server_error';
  title: string;
  message: string;
  action?: {
    label: string;
    handler: () => void;
  };
}
