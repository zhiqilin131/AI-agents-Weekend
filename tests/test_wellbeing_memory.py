"""Wellbeing (Rimumu) profile memory separation and timestamps."""

from foresight_x.profile.memory_structured import user_scope_memory_facts, wellbeing_memory_facts
from foresight_x.profile.wellbeing_memory import (
    append_wellbeing_checkin_memory,
    is_wellbeing_memory_fact,
    memory_saved_payload_from_events,
    tag_wellbeing_memory_fact,
)
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile


def test_checkin_memory_has_timestamp_and_wellbeing_category():
    profile = UserProfile(user_id="u1")
    updated, events = append_wellbeing_checkin_memory(
        profile,
        mood_score=3,
        primary_concern="Anxiety or worry",
        session_goal="Feel steadier",
        thread_id="t-abc",
    )
    assert events
    facts = updated.memory_facts or []
    checkins = [f for f in facts if is_wellbeing_memory_fact(f)]
    assert len(checkins) == 1
    f = checkins[0]
    assert f.created_at
    assert f.updated_at
    assert f.category == MemoryFactCategory.WELLBEING
    assert "Check-in" in (f.text or "")
    assert f.qualifiers.get("record_type") == "checkin"
    assert f.qualifiers.get("memory_domain") == "wellbeing"


def test_user_scope_excludes_wellbeing_facts():
    profile = UserProfile(user_id="u1")
    updated, _ = append_wellbeing_checkin_memory(
        profile,
        mood_score=5,
        primary_concern="Sleep",
        session_goal="Rest better",
    )
    general = ProfileMemoryFact(
        text="user prefers tea",
        category=MemoryFactCategory.BEHAVIOR,
        predicate="prefers",
        object_value="tea",
        created_at="2026-05-17T10:00:00Z",
    )
    all_facts = list(updated.memory_facts or []) + [general]
    user_facts = user_scope_memory_facts(all_facts)
    wb_facts = wellbeing_memory_facts(all_facts)
    assert len(wb_facts) == 1
    assert all(not is_wellbeing_memory_fact(f) for f in user_facts)
    assert any(is_wellbeing_memory_fact(f) for f in wb_facts)


def test_legacy_checkin_prefix_detected():
    legacy = ProfileMemoryFact(text="[Rimumu check-in] mood 2/10; focus: worry")
    assert is_wellbeing_memory_fact(legacy)


def test_memory_saved_payload_from_events():
    events = [
        {
            "action": "new",
            "id": "x1",
            "text": "Check-in · Mood 4/10",
            "category": "wellbeing",
        }
    ]
    payload = memory_saved_payload_from_events(events, at="2026-05-17T12:00:00Z")
    assert payload["at"] == "2026-05-17T12:00:00Z"
    assert payload["items"]
    assert payload["details"][0]["category"] == "wellbeing"


def test_tag_wellbeing_session_insight():
    fact = ProfileMemoryFact(text="User feels overwhelmed at work", category=MemoryFactCategory.BEHAVIOR)
    tagged = tag_wellbeing_memory_fact(fact, record_type="session_insight", thread_id="thr-1")
    assert tagged.category == MemoryFactCategory.WELLBEING
    assert tagged.qualifiers.get("memory_domain") == "wellbeing"
    assert tagged.qualifiers.get("therapy_thread_id") == "thr-1"
