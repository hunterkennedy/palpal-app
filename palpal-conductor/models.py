from datetime import date as Date, datetime as DateTime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field



class EpisodeExistsResponse(BaseModel):
    exists: bool


class ErrorResponse(BaseModel):
    detail: str


class ChunkResult(BaseModel):
    id: str
    episode_id: str
    chunk_index: int
    text: str
    start_time: float
    end_time: float
    duration: float
    start_formatted: str
    start_minutes: float
    word_count: int
    podcast_id: str
    podcast_name: str
    source_name: str
    site: str
    episode_title: str
    video_id: str
    publication_date: Optional[Date]
    rank: Optional[float] = None
    text_highlighted: Optional[str] = None
    title_highlighted: Optional[str] = None


class SearchResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[ChunkResult]
    corrected_query: Optional[str] = None


class ChunksResponse(BaseModel):
    chunks: list[ChunkResult]
    has_more_before: bool
    has_more_after: bool


class EpisodeInfo(BaseModel):
    id: str
    video_id: str
    title: str
    publication_date: Optional[Date]
    status: str
    error_message: Optional[str]
    blacklisted: bool
    podcast_id: str
    podcast_name: str
    source_name: str
    site: str
    duration_seconds: Optional[float]
    youtube_url: str
    created_at: Optional[DateTime] = None


class EpisodeFilter(BaseModel):
    status: Optional[str] = None       # status, 'attention', 'blacklisted', or 'all'
    podcast_id: Optional[str] = None
    site: Optional[str] = None
    q: Optional[str] = None


class BulkActionRequest(BaseModel):
    episode_ids: list[str] = []
    action: str  # "retry" | "process" | "delete" | "blacklist" | "unblacklist" | "retranscribe"
    # When all_matching is true, `filter` resolves the target set server-side
    # instead of shipping every id from the browser. This is what powers
    # "select all N matching" in the admin console.
    all_matching: bool = False
    filter: Optional[EpisodeFilter] = None


class PodcastResult(BaseModel):
    id: str
    display_name: str
    image: str
    has_icon: bool
    social_sections: list
    display_order: int


class AnalyticsSearchEvent(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    result_count: int = Field(ge=0, le=1_000_000_000)
    podcast_filter: Optional[str] = Field(default=None, max_length=100)
    top_podcast_ids: list[str] = Field(default_factory=list, max_length=10)
    corrected: bool = False


class AnalyticsOpenEvent(BaseModel):
    podcast_id: str = Field(min_length=1, max_length=100)
    episode_id: Optional[UUID] = None
    chunk_id: Optional[UUID] = None
    source_site: Optional[str] = Field(default=None, max_length=50)
