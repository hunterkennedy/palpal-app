from datetime import date as Date
from typing import Optional

from pydantic import BaseModel


class BlurbWebhookPayload(BaseModel):
    """Payload delivered by blurb via POST /blurb/webhook/{job_id}."""
    job_id: str
    status: str                  # "completed" | "failed"
    result: Optional[dict] = None  # {text, language, segments} on success
    error: Optional[str] = None    # set on failure


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


class SourceInfo(BaseModel):
    id: str
    name: str
    site: str
    type: str
    description: Optional[str]


class EpisodeInfo(BaseModel):
    id: str
    video_id: str
    title: str
    publication_date: Optional[Date]
    status: str
    error_message: Optional[str]
    podcast_id: str
    podcast_name: str
    source_name: str
    chunk_count: int
    youtube_url: str


class PodcastResult(BaseModel):
    id: str
    display_name: str
    description: str
    image: str
    theme: dict
    social_sections: list
    display_order: int
    sources: list[SourceInfo]
