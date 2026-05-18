"""Wellbeing (Rimumu) profile memories — separate from general structured memory."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from foresight_x.profile.merge import append_profile_memory_records_with_events
from foresight_x.profile.memory_rules import enrich_memory_fact
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile

WELLBEING_DOMAIN = "wellbeing"
LEGACY_CHECKIN_PREFIX = "[rimumu check-in]"


def _utc_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_wellbeing_memory_fact(fact: ProfileMemoryFact | dict[str, Any]) -> bool:
    if isinstance(fact, dict):
        cat = str(fact.get("category") or "").strip().lower()
        text = str(fact.get("text") or "")
        q = fact.get("qualifiers") if isinstance(fact.get("qualifiers"), dict) else {}
    else:
        cat = getattr(fact.category, "value", str(fact.category)).strip().lower()
        text = str(fact.text or "")
        q = fact.qualifiers or {}
    if cat == MemoryFactCategory.WELLBEING.value or cat == "wellbeing":
        return True
    if str(q.get("memory_domain") or "").strip().lower() == WELLBEING_DOMAIN:
        return True
    if text.strip().lower().startswith(LEGACY_CHECKIN_PREFIX):
        return True
    return False


def tag_wellbeing_memory_fact(
    fact: ProfileMemoryFact,
    *,
    record_type: str = "session_insight",
    thread_id: str = "",
    mood_score: int | None = None,
) -> ProfileMemoryFact:
    q = dict(fact.qualifiers or {})
    q["memory_domain"] = WELLBEING_DOMAIN
    q["record_type"] = record_type
    if thread_id:
        q["therapy_thread_id"] = thread_id[:120]
    if mood_score is not None:
        q["mood_score"] = int(mood_score)
    cat = MemoryFactCategory.WELLBEING
    update: dict[str, Any] = {"qualifiers": q, "category": cat}
    if not (fact.source_chat or "").strip():
        update["source_chat"] = "wellbeing"
    return fact.model_copy(update=update)


def _checkin_display_text(*, mood_score: int, primary_concern: str, session_goal: str) -> str:
    concern = (primary_concern or "").strip()
    goal = (session_goal or "").strip()
    parts = [f"Mood {max(0, min(10, int(mood_score)))}/10"]
    if concern:
        parts.append(concern)
    if goal and goal.lower() not in concern.lower():
        parts.append(goal)
    return " · ".join(parts)[:500]


def append_wellbeing_checkin_memory(
    profile: UserProfile,
    *,
    mood_score: int,
    primary_concern: str,
    session_goal: str,
    optional_note: str = "",
    thread_id: str = "",
    support_preference: str = "mixed",
) -> tuple[UserProfile, list[dict[str, Any]]]:
    """Persist structured check-in under wellbeing domain with explicit timestamps."""
    ts = _utc_ts()
    concern = (primary_concern or "").strip()
    goal = (session_goal or "").strip()
    note = (optional_note or "").strip()
    display = _checkin_display_text(
        mood_score=mood_score,
        primary_concern=concern,
        session_goal=goal,
    )
    rec = ProfileMemoryFact(
        id=str(uuid.uuid4()),
        category=MemoryFactCategory.WELLBEING,
        text=f"Check-in · {display}"[:500],
        source="shadow",
        created_at=ts,
        updated_at=ts,
        subject_ref="user",
        predicate="wellbeing_checkin",
        object_value=concern[:500] or goal[:500] or "session focus",
        evidence=(note or f"Goal: {goal}")[:260] if (note or goal) else concern[:260],
        source_chat="wellbeing",
        source_thread_id=(thread_id or "")[:120],
        confidence=0.92,
        importance=0.85,
        retrieval_tags=["wellbeing", "checkin", "rimumu"],
        qualifiers={
            "memory_domain": WELLBEING_DOMAIN,
            "record_type": "checkin",
            "mood_score": max(0, min(10, int(mood_score))),
            "support_preference": (support_preference or "mixed")[:32],
            "primary_concern": concern[:200],
            "session_goal": goal[:200],
        },
    )
    rec = enrich_memory_fact(rec, source_chat="wellbeing", source_thread_id=thread_id)
    updated, events = append_profile_memory_records_with_events(profile, [rec])
    return updated, [ev.model_dump() for ev in events]


def memory_saved_payload_from_events(events: list[dict[str, Any]], *, at: str | None = None) -> dict[str, Any]:
    ts = (at or _utc_ts()).strip()
    details = [
        {
            "action": str(ev.get("action") or "new"),
            "id": str(ev.get("id") or ""),
            "text": str(ev.get("text") or ""),
            "category": "wellbeing",
        }
        for ev in events
        if str(ev.get("text") or "").strip()
    ]
    items = [str(d["text"]) for d in details]
    return {
        "message": "Saved to wellbeing memory",
        "items": items,
        "at": ts,
        "details": details,
    }
