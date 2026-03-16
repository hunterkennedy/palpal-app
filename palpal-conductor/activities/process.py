import logging

import db

logger = logging.getLogger(__name__)


def chunk_segments(segments: list[dict], target_words: int = 50) -> list[list[dict]]:
    """
    Group Whisper word-level timestamps into ~target_words-word chunks.

    Each returned chunk is a list of word dicts:
        {"word": str, "start": float, "end": float, "probability": float}

    Falls back to splitting segment text evenly if no word-level data is present.
    """
    # Flatten all words across all segments into one stream
    words: list[dict] = []
    for seg in segments:
        seg_words = seg.get("words") or []
        if seg_words:
            words.extend(seg_words)
        else:
            # No word timestamps — synthesise from segment boundaries
            seg_text_words = seg["text"].split()
            if not seg_text_words:
                continue
            duration = (seg["end"] - seg["start"]) / len(seg_text_words)
            for i, w in enumerate(seg_text_words):
                words.append({
                    "word": w,
                    "start": seg["start"] + i * duration,
                    "end": seg["start"] + (i + 1) * duration,
                    "probability": 1.0,
                })

    if not words:
        return []

    chunks: list[list[dict]] = []
    current: list[dict] = []
    for word in words:
        current.append(word)
        if len(current) >= target_words:
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)
    return chunks


def format_timestamp(seconds: float) -> str:
    """Format seconds as MM:SS."""
    total_seconds = int(seconds)
    minutes = total_seconds // 60
    secs = total_seconds % 60
    return f"{minutes:02d}:{secs:02d}"


async def process_transcript(episode_id: str, transcript: dict, target_words: int = 50) -> None:
    """
    Chunk the transcript segments and bulk-insert into transcript_chunks.
    Fetches denormalized fields (podcast_id, podcast_name, source_name, etc.)
    from the DB. Deletes existing chunks first so this is safe to call for re-chunking.
    """
    pool = db.get_pool()

    row = await pool.fetchrow(
        """
        SELECT
            e.video_id,
            e.title       AS episode_title,
            e.publication_date,
            s.name        AS source_name,
            s.podcast_id,
            p.display_name AS podcast_name
        FROM episodes e
        JOIN sources s ON s.id = e.source_id
        JOIN podcasts p ON p.id = s.podcast_id
        WHERE e.id = $1::uuid
        """,
        episode_id,
    )
    if not row:
        raise RuntimeError(f"Episode {episode_id} not found in DB")

    video_id: str = row["video_id"]
    episode_title: str = row["episode_title"]
    publication_date = row["publication_date"]
    source_name: str = row["source_name"]
    podcast_id: str = row["podcast_id"]
    podcast_name: str = row["podcast_name"]

    segments: list[dict] = transcript.get("segments", [])
    if not segments:
        logger.warning(
            f"Episode {episode_id}: transcript has no segments"
        )
        return

    chunks = chunk_segments(segments, target_words=target_words)
    logger.info(
        f"Episode {episode_id}: {len(segments)} segments → {len(chunks)} chunks (target_words={target_words})"
    )

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO transcripts (episode_id, language, segments)
                VALUES ($1::uuid, $2, $3::jsonb)
                ON CONFLICT (episode_id) DO UPDATE
                    SET language = EXCLUDED.language,
                        segments = EXCLUDED.segments
                """,
                episode_id,
                transcript.get("language"),
                transcript.get("segments", []),
            )

            await conn.execute(
                "DELETE FROM transcript_chunks WHERE episode_id = $1::uuid",
                episode_id,
            )

            for chunk_index, chunk_words in enumerate(chunks):
                text = " ".join(w["word"].strip() for w in chunk_words)
                start_time = float(chunk_words[0]["start"])
                end_time = float(chunk_words[-1]["end"])
                duration = end_time - start_time
                start_formatted = format_timestamp(start_time)
                start_minutes = start_time / 60
                word_count = len(chunk_words)

                await conn.execute(
                    """
                    INSERT INTO transcript_chunks (
                        episode_id, chunk_index,
                        text, word_count,
                        start_time, end_time, duration,
                        start_formatted, start_minutes,
                        podcast_id, podcast_name, source_name,
                        episode_title, video_id, publication_date
                    ) VALUES (
                        $1::uuid, $2,
                        $3, $4,
                        $5, $6, $7,
                        $8, $9,
                        $10, $11, $12,
                        $13, $14, $15::date
                    )
                    """,
                    episode_id, chunk_index,
                    text, word_count,
                    start_time, end_time, duration,
                    start_formatted, start_minutes,
                    podcast_id, podcast_name, source_name,
                    episode_title, video_id, publication_date,
                )

    logger.info(
        f"Episode {episode_id}: inserted {len(chunks)} transcript chunks"
    )
