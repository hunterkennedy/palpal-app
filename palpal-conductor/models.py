from datetime import date as Date, datetime as DateTime
from typing import Optional

from pydantic import BaseModel



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
    chunk_count: int
    duration_seconds: Optional[float]
    youtube_url: str
    created_at: Optional[DateTime] = None


class BulkActionRequest(BaseModel):
    episode_ids: list[str]
    action: str  # "retry" | "process"


class PodcastResult(BaseModel):
    id: str
    display_name: str
    description: str
    image: str
    has_icon: bool
    social_sections: list
    display_order: int
