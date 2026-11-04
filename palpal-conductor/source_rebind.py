"""Rebind a source to a new URL/site without losing episode history.

Changing a source URL can change the adapter that discovers episodes, and each
adapter may use a different ``video_id`` for the same episode (e.g. Patreon's
numeric post IDs vs. an RSS feed's GUID). Applying that change naively would
orphan every old episode and re-insert the whole feed as new.

This module builds a conservative match plan first, then applies it in one
transaction. Matching is intentionally ordered from strongest to weakest:

    exact video_id -> canonical ID extracted from a URL/GUID
    -> normalized title + publication date -> unique normalized title

Ambiguous matches are reported and are never merged automatically.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from typing import Any

import caches
import db
import pipeline_settings as settings
from activities.discovery import apply_discovery_results

logger = logging.getLogger(__name__)

_PATREON_POST_RE = re.compile(r"/posts/(?:[^/?#]+-)?(\d+)(?:[/?#]|$)")
_YOUTUBE_ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")
_NON_WORD_RE = re.compile(r"[^\w]+", re.UNICODE)


class SourceRebindError(RuntimeError):
    """The preview is stale/invalid or the source cannot be rebind-ed right now."""


def normalize_title(title: str | None) -> str:
    """Case/punctuation-insensitive title key for fallback matching."""
    value = (title or "").casefold().replace("&", " and ")
    value = _NON_WORD_RE.sub(" ", value)
    return " ".join(value.split())


def canonical_id_candidates(video_id: str | None) -> set[str]:
    """Possible stable IDs embedded in a video_id/GUID/URL.

    Patreon RSS GUIDs are usually the numeric post ID, which matches the ID
    returned by the Patreon scraper. Some feeds use a post URL instead; pull the
    trailing numeric post ID out so the old Patreon rows still match.
    """
    value = (video_id or "").strip()
    if not value:
        return set()

    candidates = {value}
    if value.isdigit():
        candidates.add(value)

    youtube = _YOUTUBE_ID_RE.search(value)
    if youtube:
        candidates.add(youtube.group(1))

    patreon = _PATREON_POST_RE.search(value)
    if patreon:
        candidates.add(patreon.group(1))

    return candidates


def _coerce_filters(value: Any) -> dict:
    """Filters may arrive as a dict, a JSON string, or a double-encoded string."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
                return parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


def _iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    return text[:10] or None


def _entry_view(entry: dict) -> dict:
    return {
        "video_id": str(entry.get("video_id") or "").strip(),
        "title": str(entry.get("title") or "").strip(),
        "pub_date": _iso_date(entry.get("pub_date") or entry.get("publication_date")),
        "duration": entry.get("duration"),
    }


def _row_view(row: dict) -> dict:
    duration = row.get("duration_seconds")
    return {
        "id": str(row["id"]),
        "video_id": str(row.get("video_id") or ""),
        "title": str(row.get("title") or ""),
        "pub_date": _iso_date(row.get("publication_date")),
        "duration": float(duration) if duration is not None else None,
        "status": str(row.get("status") or ""),
        "blacklisted": bool(row.get("blacklisted")),
    }


def _index_one(items: list[dict], key) -> dict[Any, list[int]]:
    index: dict[Any, list[int]] = {}
    for position, item in enumerate(items):
        value = key(item)
        if value:
            index.setdefault(value, []).append(position)
    return index


def _classify(entry: dict, title_exclude: list[str], min_duration: int) -> str:
    title = entry["title"]
    if not entry["video_id"]:
        return "invalid"
    if not title or (title.startswith("[") and title.endswith("]")):
        return "unavailable"
    if any(excluded in title.lower() for excluded in title_exclude):
        return "title_excluded"
    duration = entry.get("duration")
    if min_duration > 0 and duration is not None and duration < min_duration:
        return "too_short"
    return "eligible"


async def build_reconcile_plan(
    source: dict,
    entries: list[dict],
    *,
    current_site: str,
    current_url: str,
    candidate_site: str,
    candidate_url: str,
    candidate_name: str | None = None,
    candidate_enabled: bool | None = None,
    candidate_filters: dict | None = None,
) -> dict:
    """Match a candidate source's entries against this source's existing episodes.

    Returns a JSON-serializable plan. The full entry list and match mapping are
    included so the apply step can use the exact snapshot the admin reviewed,
    even if the feed changes before they press Apply.
    """
    pool = db.get_pool()
    filters = _coerce_filters(candidate_filters) if candidate_filters is not None else _coerce_filters(source.get("filters"))
    title_exclude = [str(value).lower() for value in (filters or {}).get("title_exclude", [])]
    min_duration = await settings.get_int("min_episode_duration_seconds")

    existing_rows = [
        _row_view(row)
        for row in await pool.fetch(
            """
            SELECT id::text, video_id, title, publication_date, duration_seconds,
                   status, blacklisted
            FROM episodes
            WHERE source_id = $1::uuid
            """,
            source["id"],
        )
    ]
    items = [_entry_view(entry) for entry in entries]

    by_id = _index_one(existing_rows, lambda row: row["video_id"])
    by_canonical: dict[str, list[int]] = {}
    for position, row in enumerate(existing_rows):
        for candidate in canonical_id_candidates(row["video_id"]):
            by_canonical.setdefault(candidate, []).append(position)

    by_title_date = _index_one(
        existing_rows,
        lambda row: (normalize_title(row["title"]), row["pub_date"])
        if normalize_title(row["title"]) and row["pub_date"] else None,
    )
    by_title = _index_one(
        existing_rows,
        lambda row: normalize_title(row["title"]) or None,
    )

    entry_by_title_date = _index_one(
        items,
        lambda item: (normalize_title(item["title"]), item["pub_date"])
        if normalize_title(item["title"]) and item["pub_date"] else None,
    )
    entry_by_title = _index_one(
        items,
        lambda item: normalize_title(item["title"]) or None,
    )

    used_rows: set[int] = set()
    used_items: set[int] = set()
    matches: list[dict] = []
    ambiguous: list[dict] = []
    metadata = {
        "video_id_rebound": 0,
        "title_filled": 0,
        "title_trimmed": 0,
        "publication_date_filled": 0,
        "duration_filled": 0,
        "failed_retried": 0,
    }
    matched_exact = 0
    matched_canonical = 0
    matched_title_date = 0
    matched_title = 0
    would_reactivate = 0

    def note_ambiguous(item: dict, reason: str) -> None:
        ambiguous.append({
            "video_id": item["video_id"],
            "title": item["title"],
            "pub_date": item["pub_date"],
            "duration": item["duration"],
            "reason": reason,
        })

    def add_match(row_position: int, item_position: int, how: str) -> bool:
        nonlocal matched_exact, matched_canonical, matched_title_date, matched_title
        nonlocal would_reactivate

        row = existing_rows[row_position]
        item = items[item_position]
        new_video_id = item["video_id"]

        conflicts = [
            other for other in by_id.get(new_video_id, [])
            if other != row_position and other not in used_rows
        ]
        if conflicts:
            note_ambiguous(item, "candidate video_id already belongs to another episode")
            return False

        used_rows.add(row_position)
        used_items.add(item_position)

        old_title = row["title"]
        entry_title = item["title"]
        final_title = old_title.strip() or entry_title
        title_changed = final_title != old_title
        if not old_title.strip() and entry_title:
            metadata["title_filled"] += 1
        elif old_title and old_title != old_title.strip():
            metadata["title_trimmed"] += 1

        final_pub_date = row["pub_date"] or item["pub_date"]
        if row["pub_date"] is None and item["pub_date"] is not None:
            metadata["publication_date_filled"] += 1

        final_duration = row["duration"] if row["duration"] is not None else item["duration"]
        if row["duration"] is None and item["duration"] is not None:
            metadata["duration_filled"] += 1

        if row["video_id"] != new_video_id:
            metadata["video_id_rebound"] += 1
        if row["status"] == "failed":
            metadata["failed_retried"] += 1
        if row["status"] == "orphaned":
            would_reactivate += 1

        if how == "exact":
            matched_exact += 1
        elif how == "canonical":
            matched_canonical += 1
        elif how == "title_date":
            matched_title_date += 1
        else:
            matched_title += 1

        matches.append({
            "episode_id": row["id"],
            "old_video_id": row["video_id"],
            "new_video_id": new_video_id,
            "title": final_title,
            "title_changed": title_changed,
            "pub_date": final_pub_date,
            "duration": final_duration,
            "how": how,
        })
        return True

    for item_position, item in enumerate(items):
        if not item["video_id"]:
            continue

        # 1. Exact video_id (the common case, including a rotated auth token
        #    whose feed keeps stable GUIDs).
        exact = by_id.get(item["video_id"], [])
        if len(exact) == 1 and exact[0] not in used_rows:
            add_match(exact[0], item_position, "exact")
            continue
        if len(exact) > 1:
            note_ambiguous(item, "video_id matches multiple existing episodes")
            continue

        # 2. Canonical IDs pulled out of a URL/GUID (Patreon post IDs, YouTube IDs).
        canonical_rows: set[int] = set()
        for candidate in canonical_id_candidates(item["video_id"]):
            canonical_rows.update(by_canonical.get(candidate, []))
        canonical_rows -= used_rows
        if len(canonical_rows) == 1:
            add_match(next(iter(canonical_rows)), item_position, "canonical")
            continue
        if len(canonical_rows) > 1:
            note_ambiguous(item, "canonical ID matches multiple existing episodes")
            continue

        # 3. Normalized title + publication date.
        title = normalize_title(item["title"])
        if title and item["pub_date"]:
            key = (title, item["pub_date"])
            row_candidates = [position for position in by_title_date.get(key, []) if position not in used_rows]
            item_candidates = entry_by_title_date.get(key, [])
            if len(row_candidates) == 1 and len(item_candidates) == 1:
                add_match(row_candidates[0], item_position, "title_date")
                continue
            if len(row_candidates) > 1:
                note_ambiguous(item, "title/date matches multiple existing episodes")
                continue

        # 4. Unique normalized title. Only when at least one side lacks a date,
        #    otherwise a date mismatch should prevent an automatic merge.
        if title:
            title_by_title = entry_by_title.get(title, [])
            row_candidates = [position for position in by_title.get(title, []) if position not in used_rows]
            if len(title_by_title) == 1 and len(row_candidates) == 1:
                row_position = row_candidates[0]
                row = existing_rows[row_position]
                if item["pub_date"] is None or row["pub_date"] is None:
                    add_match(row_position, item_position, "title")
                    continue
            if len(row_candidates) > 1:
                note_ambiguous(item, "title matches multiple existing episodes")

    counts = {
        "unavailable": 0,
        "title_excluded": 0,
        "too_short": 0,
        "invalid": 0,
    }
    adds: list[dict] = []
    for item_position, item in enumerate(items):
        classification = _classify(item, title_exclude, min_duration)
        if classification in counts:
            counts[classification] += 1
        if classification != "eligible" or item_position in used_items:
            continue
        if item["video_id"] in by_id:
            note_ambiguous(item, "candidate video_id already exists under another episode")
            continue
        adds.append(item)

    orphan_candidates = [
        row for position, row in enumerate(existing_rows)
        if position not in used_rows and not row["blacklisted"]
    ]

    plan = {
        "kind": "source_rebind",
        "source_id": source["id"],
        "from": {"site": current_site, "url": current_url},
        "to": {
            "site": candidate_site,
            "url": candidate_url,
            "name": candidate_name,
            "enabled": candidate_enabled,
            "filters": filters,
        },
        "entry_count": len(items),
        "existing_count": len(existing_rows),
        "matched": len(matches),
        "matched_exact": matched_exact,
        "matched_canonical": matched_canonical,
        "matched_title_date": matched_title_date,
        "matched_title": matched_title,
        "would_add": len(adds),
        "would_orphan": len(orphan_candidates),
        "would_reactivate": would_reactivate,
        "metadata": metadata,
        "unavailable": counts["unavailable"],
        "title_excluded": counts["title_excluded"],
        "too_short": counts["too_short"],
        "invalid": counts["invalid"],
        "ambiguous_count": len(ambiguous),
        "ambiguous": ambiguous[:50],
        "sample_matches": matches[:30],
        "sample_adds": adds[:30],
        "sample_orphans": orphan_candidates[:30],
        # Full snapshot used by the apply step.
        "entries": items,
        "matches": matches,
    }
    return plan


async def apply_source_rebind(source_id: str, job_id: str, *, auto_queue: bool = True) -> dict:
    """Apply a source-rebind preview snapshot in one transaction."""
    pool = db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            job = await conn.fetchrow(
                """
                SELECT id::text, kind, status, payload, result,
                       created_at, finished_at
                FROM jobs
                WHERE id = $1::uuid
                FOR UPDATE
                """,
                job_id,
            )
            if not job:
                raise SourceRebindError("Preview job not found")
            if job["kind"] != "discover" or job["status"] != "completed":
                raise SourceRebindError("Preview job is not a completed discovery job")

            payload = job["payload"] or {}
            result = job["result"] or {}
            if not payload.get("reconcile") or not payload.get("dry_run"):
                raise SourceRebindError("That job is not a source-rebind preview")
            if result.get("applied_at"):
                raise SourceRebindError("That preview has already been applied")

            # _summarize_dry_run stores the plan directly as the job result so
            # the admin drawer can read its fields at the top level. Older/test
            # snapshots may wrap it under "plan"; accept both shapes.
            plan = result.get("plan") if isinstance(result.get("plan"), dict) else result
            if not isinstance(plan, dict) or plan.get("kind") != "source_rebind":
                raise SourceRebindError("Preview result is missing its rebind plan")
            if plan.get("source_id") != source_id:
                raise SourceRebindError("Preview belongs to a different source")

            source = await conn.fetchrow(
                """
                SELECT id::text, podcast_id, name, site, url, enabled, filters
                FROM sources
                WHERE id = $1::uuid
                FOR UPDATE
                """,
                source_id,
            )
            if not source:
                raise SourceRebindError("Source no longer exists")

            current = plan.get("from") or {}
            if source["site"] != current.get("site") or source["url"] != current.get("url"):
                raise SourceRebindError(
                    "Source URL/site changed after this preview was created; run the preview again"
                )

            active = await conn.fetchval(
                """
                SELECT 1
                FROM jobs
                WHERE kind = 'discover'
                  AND status IN ('pending', 'claimed')
                  AND source_id = $1::uuid
                LIMIT 1
                """,
                source_id,
            )
            if active:
                raise SourceRebindError("A discovery job is already running for this source")

            newer_discovery = await conn.fetchval(
                """
                SELECT 1
                FROM jobs
                WHERE kind = 'discover'
                  AND status = 'completed'
                  AND source_id = $1::uuid
                  AND id != $2::uuid
                  AND COALESCE(finished_at, created_at) > COALESCE($3::timestamptz, $4::timestamptz)
                LIMIT 1
                """,
                source_id,
                job_id,
                job["finished_at"],
                job["created_at"],
            )
            if newer_discovery:
                raise SourceRebindError(
                    "A newer discovery result arrived after this preview; run the preview again"
                )

            active_process = await conn.fetchval(
                """
                SELECT 1
                FROM jobs j
                JOIN episodes e ON e.id = j.episode_id
                WHERE j.kind = 'process'
                  AND j.status IN ('pending', 'claimed')
                  AND e.source_id = $1::uuid
                LIMIT 1
                """,
                source_id,
            )
            if active_process:
                raise SourceRebindError(
                    "This source has pending/active process jobs; wait for them to finish and preview again"
                )

            target = plan.get("to") or {}
            raw_target_filters = target.get("filters")
            target_filters = (
                _coerce_filters(raw_target_filters)
                if raw_target_filters is not None
                else _coerce_filters(source["filters"])
            )

            await conn.execute(
                """
                UPDATE sources
                SET name = $1,
                    site = $2,
                    url = $3,
                    enabled = $4,
                    filters = $5::jsonb,
                    updated_at = NOW()
                WHERE id = $6::uuid
                """,
                target.get("name") or source["name"],
                target["site"],
                target["url"],
                source["enabled"] if target.get("enabled") is None else bool(target["enabled"]),
                target_filters,
                source_id,
            )

            for match in plan.get("matches", []):
                await conn.execute(
                    """
                    UPDATE episodes
                    SET video_id = $2,
                        title = $3,
                        publication_date = $4::text::date,
                        duration_seconds = $5,
                        status = CASE WHEN status = 'failed' THEN 'discovered' ELSE status END,
                        error_message = CASE WHEN status = 'failed' THEN NULL ELSE error_message END,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    match["episode_id"],
                    match["new_video_id"],
                    match["title"],
                    match["pub_date"],
                    match["duration"],
                )
                await conn.execute(
                    """
                    UPDATE transcript_chunks
                    SET video_id = $2,
                        episode_title = $3,
                        publication_date = $4::text::date
                    WHERE episode_id = $1::uuid
                    """,
                    match["episode_id"],
                    match["new_video_id"],
                    match["title"],
                    match["pub_date"],
                )
            retried = int((plan.get("metadata") or {}).get("failed_retried") or 0)

            new_episodes, reactivated = await apply_discovery_results(
                source_id,
                target_filters,
                plan.get("entries", []),
                conn=conn,
            )

            counts = {
                "source_id": source_id,
                "matched": int(plan.get("matched") or 0),
                "rebound": int((plan.get("metadata") or {}).get("video_id_rebound") or 0),
                "added": len(new_episodes),
                "orphaned": int(plan.get("would_orphan") or 0),
                "reactivated": int(reactivated),
                "retried": retried,
                "metadata": plan.get("metadata") or {},
            }
            await conn.execute(
                """
                UPDATE jobs
                SET result = result || jsonb_build_object(
                    'applied_at', to_jsonb(NOW()),
                    'applied_counts', $2::jsonb
                )
                WHERE id = $1::uuid
                """,
                job_id,
                counts,
            )

    caches.bust_episodes_cache()
    caches.bust_podcasts_cache()

    if auto_queue and (counts["added"] or counts["reactivated"] or counts["retried"]):
        # Imported lazily to avoid a circular import: pipeline imports this
        # module for the preview-side helper.
        from pipeline import wakeup_worker
        wakeup_worker()

    logger.info(
        "Source %s rebound: %d matched, %d added, %d orphaned, %d retried",
        source_id, counts["matched"], counts["added"], counts["orphaned"], counts["retried"],
    )
    return counts
