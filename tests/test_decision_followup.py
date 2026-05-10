"""Decision follow-up eligibility, persistence, and due selection."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from foresight_x.config import Settings
from foresight_x.harness.decision_followup import (
    create_decision_followup_if_needed,
    dismiss_followup,
    filter_for_toast_delivery,
    get_due_followups,
    load_all_followups,
    save_all_followups,
    should_create_followup,
    still_pending_followup,
)
from foresight_x.harness.trace import save_decision_trace
from foresight_x.schemas import DecisionTrace, Reversibility, TimePressure, UserState


@pytest.fixture
def iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    return Settings()


def _minimal_trace(
    decision_id: str,
    *,
    raw: str,
    decision_type: str = "general",
    time_pressure: TimePressure = TimePressure.LOW,
    deadline_hint: str | None = None,
) -> DecisionTrace:
    us = UserState(
        raw_input=raw,
        goals=["g"],
        time_pressure=time_pressure,
        stress_level=1,
        workload=1,
        current_behavior="c",
        decision_type=decision_type,
        reversibility=Reversibility.PARTIAL,
        deadline_hint=deadline_hint,
    )
    return DecisionTrace.model_validate(
        {
            "decision_id": decision_id,
            "timestamp": "2026-05-01T12:00:00Z",
            "original_user_input": raw,
            "user_state": us.model_dump(mode="json"),
            "memory": {
                "similar_past_decisions": [],
                "behavioral_patterns": [],
                "prior_outcomes_summary": "",
            },
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
                "reasoning": "Because it fits your goals.",
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


def test_career_decision_creates_followup(iso: Settings) -> None:
    tr = _minimal_trace("d-career", raw="Should I take the new job offer?", decision_type="career")
    save_decision_trace(tr, settings=iso)
    fu = create_decision_followup_if_needed("u1", "d-career", tr, settings=iso)
    assert fu is not None
    assert fu.decision_id == "d-career"
    assert fu.schedule.offsets_days == [3, 7, 14]


def test_trivial_food_skips_followup(iso: Settings) -> None:
    tr = _minimal_trace("d-pizza", raw="Pizza or sushi for lunch?")
    elig = should_create_followup(tr)
    assert elig.should_create is False


def test_time_sensitive_offsets(iso: Settings) -> None:
    tr = _minimal_trace(
        "d-deadline",
        raw="Submit application by Friday — should I apply?",
        decision_type="general",
        time_pressure=TimePressure.HIGH,
    )
    elig = should_create_followup(tr)
    assert elig.should_create is True
    assert elig.schedule_offsets_days == [1, 3, 7]


def test_get_due_respects_next_due_at(iso: Settings) -> None:
    uid = "u2"
    tr = _minimal_trace("d1", raw="Career pivot planning", decision_type="career")
    save_decision_trace(tr, settings=iso)
    fu = create_decision_followup_if_needed(uid, "d1", tr, settings=iso)
    assert fu is not None
    items = load_all_followups(uid, settings=iso)
    items[0] = fu.model_copy(update={"next_due_at": "2026-05-05T12:00:00Z"})
    save_all_followups(uid, items, settings=iso)

    now = datetime(2026, 5, 10, 14, 0, tzinfo=timezone.utc)
    due = get_due_followups(uid, now=now, tz_name="UTC", settings=iso)
    assert len(due) == 1
    assert due[0].id == fu.id


def test_quiet_hours_empty(iso: Settings) -> None:
    uid = "u3"
    tr = _minimal_trace("d2", raw="Should I join the hackathon?", decision_type="academic")
    save_decision_trace(tr, settings=iso)
    fu = create_decision_followup_if_needed(uid, "d2", tr, settings=iso)
    assert fu is not None
    items = load_all_followups(uid, settings=iso)
    items[0] = fu.model_copy(update={"next_due_at": "2026-05-05T12:00:00Z"})
    save_all_followups(uid, items, settings=iso)
    # 03:00 UTC → before 09:00 local for UTC
    now = datetime(2026, 5, 10, 3, 0, tzinfo=timezone.utc)
    due = get_due_followups(uid, now=now, tz_name="UTC", settings=iso)
    assert due == []


def test_daily_cap_filter(iso: Settings) -> None:
    uid = "u4"
    tr = _minimal_trace("d3", raw="Grad school vs work", decision_type="academic")
    save_decision_trace(tr, settings=iso)
    fu = create_decision_followup_if_needed(uid, "d3", tr, settings=iso)
    assert fu is not None
    items = load_all_followups(uid, settings=iso)
    past = "2026-05-10T12:00:00Z"
    items[0] = items[0].model_copy(update={"next_due_at": past, "last_shown_at": None})
    save_all_followups(uid, items, settings=iso)
    now = datetime(2026, 5, 10, 14, 0, tzinfo=timezone.utc)
    cand = get_due_followups(uid, now=now, tz_name="UTC", settings=iso)
    today = now.astimezone(ZoneInfo("UTC")).date().isoformat()
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", uid)
    nf = iso.followups_dir / ".notify" / f"{safe}.json"
    nf.parent.mkdir(parents=True, exist_ok=True)
    nf.write_text(
        json.dumps(
            {
                "displays": [
                    {"followup_id": "x", "at": "2026-05-10T10:00:00Z", "local_date": today},
                    {"followup_id": "y", "at": "2026-05-10T11:00:00Z", "local_date": today},
                ]
            }
        ),
        encoding="utf-8",
    )
    filtered = filter_for_toast_delivery(uid, cand, tz_name="UTC", max_per_day=2, settings=iso)
    assert filtered == []


def test_dismiss_increments_and_stops(iso: Settings) -> None:
    uid = "u5"
    tr = _minimal_trace("d4", raw="Big life choice", decision_type="relationship")
    save_decision_trace(tr, settings=iso)
    fu = create_decision_followup_if_needed(uid, "d4", tr, settings=iso)
    assert fu is not None
    d1 = dismiss_followup(uid, fu.id, reason="dismissed", settings=iso)
    assert d1 is not None
    assert d1.dismissed_count == 1
    d2 = dismiss_followup(uid, fu.id, reason="dismissed", settings=iso)
    assert d2 is not None
    assert d2.dismissed_count == 2
    assert d2.status == "dismissed"


def test_still_pending_snoozes(iso: Settings) -> None:
    uid = "u6"
    tr = _minimal_trace("d5", raw="Plan relocation", decision_type="planning")
    save_decision_trace(tr, settings=iso)
    fu = create_decision_followup_if_needed(uid, "d5", tr, settings=iso)
    assert fu is not None
    items = load_all_followups(uid, settings=iso)
    items[0] = fu.model_copy(update={"next_due_at": "2026-05-01T12:00:00Z", "status": "scheduled"})
    save_all_followups(uid, items, settings=iso)
    sp = still_pending_followup(uid, fu.id, settings=iso)
    assert sp is not None
    assert sp.status == "snoozed"
    assert sp.snoozed_until


def test_no_duplicate_followup_same_decision(iso: Settings) -> None:
    tr = _minimal_trace("d6", raw="Important career move", decision_type="career")
    save_decision_trace(tr, settings=iso)
    a = create_decision_followup_if_needed("u7", "d6", tr, settings=iso)
    b = create_decision_followup_if_needed("u7", "d6", tr, settings=iso)
    assert a is not None
    assert b is None
