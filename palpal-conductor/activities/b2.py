"""
Backblaze B2 transcript storage (S3-compatible API via boto3).

Objects are stored as:  transcripts/{episode_id}.json
Content:                {"language": "...", "segments": [...]}

Required env vars:
  B2_ENDPOINT_URL  — e.g. https://s3.us-east-005.backblazeb2.com
  B2_KEY_ID        — application key ID
  B2_APP_KEY       — application key
  B2_BUCKET        — bucket name
"""

import asyncio
import json
import logging
import os

import boto3
from botocore.config import Config as BotocoreConfig
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=os.environ["B2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["B2_KEY_ID"],
            aws_secret_access_key=os.environ["B2_APP_KEY"],
            config=BotocoreConfig(connect_timeout=10, read_timeout=120, retries={"max_attempts": 2}),
        )
    return _client


def _bucket() -> str:
    return os.environ["B2_BUCKET"]


def _key(episode_id: str) -> str:
    return f"transcripts/{episode_id}.json"


async def upload_transcript(episode_id: str, transcript: dict) -> None:
    """Upload transcript JSON to B2. Overwrites if it already exists."""
    client = _get_client()
    data = json.dumps(transcript).encode()
    await asyncio.to_thread(
        client.put_object,
        Bucket=_bucket(),
        Key=_key(episode_id),
        Body=data,
        ContentType="application/json",
    )
    logger.debug("Uploaded transcript for episode %s to B2", episode_id)


async def download_transcript(episode_id: str) -> dict | None:
    """Download and return transcript JSON from B2. Returns None if not found."""
    client = _get_client()
    try:
        resp = await asyncio.to_thread(
            client.get_object,
            Bucket=_bucket(),
            Key=_key(episode_id),
        )
        data = await asyncio.to_thread(resp["Body"].read)
        return json.loads(data)
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            return None
        raise


async def delete_transcript(episode_id: str) -> None:
    """Delete transcript from B2. No-op if the object does not exist."""
    client = _get_client()
    await asyncio.to_thread(
        client.delete_object,
        Bucket=_bucket(),
        Key=_key(episode_id),
    )
    logger.debug("Deleted transcript for episode %s from B2", episode_id)
