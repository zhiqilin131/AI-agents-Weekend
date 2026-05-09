"""Diary source aggregation uses existing stores (no duplicate SOt)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from foresight_x.calendar_agent.schemas import CalendarEvent
from foresight_x.calendar_agent.store import replace_events
from foresight_x.config import Settings
from foresight_x.diary.schemas import DiaryEntry
from foresight_x.diary.source_adapter import bundle_has_activity, collect_diary_sources_for_date
from foresight_x.harness.trace import save_decision_trace
from foresight_x.profile.store import save_user_profile
from foresight_x.schemas import (
    DecisionTrace,
    ProfileMemoryFact,
    Reversibility,
    TimePressure,
    UserProfile,
    UserState,
)


@pytest.fixture
def iso(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Settings:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    return Settings()


def _write_thread(tmp_path: Path, user_id: str, thread_id: str, messages: list[dict], source: str | None = None) -> None:
    d = tmp_path / "chat_threads" / user_id
    d.mkdir(parents=True, exist_ok=True)
    thread = {
        "thread_id": thread_id,
        "user_id": user_id,
        "title": "t",
        "created_at": "2026-05-09T10:00:00Z",
        "updated_at": "2026-05-09T10:00:00Z",
        "mode": "normal",
        "messages": messages,
        "memory_events": [],
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
        "linked_decision_ids": [],
        "working_summary": "",
        "temporary_context": [],
        "clarification_events": [],
        "clarification_state": {"answered_dimensions": [], "skipped_dimensions": []},
    }
    if source:
        thread["source"] = source
    (d / f"{thread_id}.json").write_text(json.dumps(thread), encoding="utf-8")


def test_collect_reads_chat_messages(iso: Settings) -> None:
    uid = "demo_user"
    _write_thread(
        iso.foresight_data_dir,
        uid,
        "thr-chat",
        [
            {
                "id": "m1",
                "role": "user",
                "content": "Discussing the Redwood internship panel",
                "created_at": "2026-05-09T14:30:00Z",
                "status": "complete",
                "metadata": {"mode": "normal"},
            }
        ],
    )
    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso)
    assert len(b.chat_messages) == 1
    assert b.chat_messages[0].message_id == "m1"
    assert "thr-chat" in b.source_refs.thread_ids


def test_collect_reads_voice_turns(iso: Settings) -> None:
    uid = "demo_user"
    _write_thread(
        iso.foresight_data_dir,
        uid,
        "thr-voice",
        [
            {
                "id": "mv1",
                "role": "user",
                "content": "Slime voice ping",
                "created_at": "2026-05-09T09:00:00Z",
                "status": "complete",
                "metadata": {"modality": "voice", "interaction_source": "slime_voice"},
            }
        ],
        source="slime_voice",
    )
    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso)
    assert len(b.voice_turns) == 1
    assert b.voice_turns[0].message_id == "mv1"


def test_collect_reads_decision_reports(iso: Settings) -> None:
    uid = "demo_user"
    us = UserState(
        raw_input="choose internship",
        active_user_id=uid,
        goals=["g"],
        time_pressure=TimePressure.LOW,
        stress_level=1,
        workload=1,
        current_behavior="c",
        decision_type="general",
        reversibility=Reversibility.PARTIAL,
    )
    trace = DecisionTrace.model_validate(
        {
            "decision_id": "dec-diary-1",
            "timestamp": "2026-05-09T18:00:00Z",
            "user_state": us.model_dump(mode="json"),
            "memory": {"similar_past_decisions": [], "behavioral_patterns": [], "prior_outcomes_summary": ""},
            "evidence": {"facts": [], "base_rates": [], "recent_events": []},
            "rationality": {
                "is_rational_state": True,
                "detected_biases": [],
                "confidence": 0.5,
                "recommended_slowdowns": [],
            },
            "options": [],
            "futures": [],
            "evaluations": [],
            "recommendation": {
                "chosen_option_id": "x",
                "reasoning": "r",
                "next_actions": [],
                "reassessment_triggers": [],
            },
            "reflection": {
                "possible_errors": [],
                "uncertainty_sources": [],
                "model_limitations": [],
                "information_gaps": [],
                "self_improvement_signal": "s",
            },
        }
    )
    save_decision_trace(trace, settings=iso)
    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso.model_copy(update={"foresight_user_id": uid}))
    assert len(b.decision_reports) == 1
    assert b.decision_reports[0].decision_id == "dec-diary-1"
    assert "dec-diary-1" in b.source_refs.decision_ids


def test_collect_includes_memory_when_created_at_matches_day(iso: Settings) -> None:
    uid = "demo_user"
    prof = UserProfile(
        user_id=uid,
        memory_facts=[
            ProfileMemoryFact(
                id="mf-day",
                text="Stable preference for morning deep work",
                source="shadow",
                created_at="2026-05-09T08:00:00Z",
            )
        ],
    )
    save_user_profile(prof, settings=iso.model_copy(update={"foresight_user_id": uid}))
    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso.model_copy(update={"foresight_user_id": uid}))
    ids = {m.memory_id for m in b.approved_memories}
    assert "mf-day" in ids


def test_collect_reads_calendar(iso: Settings) -> None:
    uid = "demo_user"
    ev = CalendarEvent(
        id="cal-1",
        title="Deep work",
        start="2026-05-09T11:00:00+00:00",
        end="2026-05-09T12:00:00+00:00",
        source="manual",
    )
    replace_events(iso, uid, [ev])
    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso)
    assert len(b.calendar_items) >= 1
    assert any(x.id == "cal-1" for x in b.calendar_items)


def test_collect_includes_relevant_memory_facts(iso: Settings) -> None:
    uid = "demo_user"
    _write_thread(
        iso.foresight_data_dir,
        uid,
        "thr-m",
        [
            {
                "id": "mx",
                "role": "user",
                "content": "Rose might join the study session",
                "created_at": "2026-05-09T16:00:00Z",
                "status": "complete",
                "metadata": {"mode": "normal"},
            }
        ],
    )
    prof = UserProfile(
        user_id=uid,
        memory_facts=[
            ProfileMemoryFact(
                id="mf-rose",
                text="Rose is an important collaborator for school projects.",
                source="shadow",
                status="active",
            )
        ],
    )
    save_user_profile(prof, settings=iso.model_copy(update={"foresight_user_id": uid}))

    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso.model_copy(update={"foresight_user_id": uid}))
    ids = {m.memory_id for m in b.approved_memories}
    assert "mf-rose" in ids


def test_empty_day_has_no_activity(iso: Settings) -> None:
    b = collect_diary_sources_for_date("demo_user", "2026-01-02", "UTC", settings=iso)
    assert not bundle_has_activity(b)


def test_diary_entry_memory_indexed_false() -> None:
    e = DiaryEntry.model_validate(
        {
            "id": "x" * 12,
            "user_id": "demo_user",
            "date": "2026-05-09",
            "title": "t",
            "summary": "s",
            "memory_indexed": True,
        }
    )
    assert e.memory_indexed is False


def test_diary_entry_stores_refs_not_bulk_chat(iso: Settings) -> None:
    uid = "demo_user"
    _write_thread(
        iso.foresight_data_dir,
        uid,
        "thr-x",
        [
            {
                "id": "fullmsg",
                "role": "user",
                "content": "x" * 4000,
                "created_at": "2026-05-09T12:00:00Z",
                "status": "complete",
                "metadata": {"mode": "normal"},
            }
        ],
    )
    b = collect_diary_sources_for_date(uid, "2026-05-09", "UTC", settings=iso)
    assert len(b.chat_messages[0].preview) < 400
