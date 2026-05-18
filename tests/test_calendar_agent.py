"""Calendar Agent: parse, schedule, conflicts, confirm (user-scoped store)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from foresight_x.calendar_agent.calendar_service import build_draft_from_intent, confirm_draft
from foresight_x.calendar_agent.conflict_detector import detect_conflicts
from foresight_x.calendar_agent.datetime_hints import resolve_datetime_hints
from foresight_x.calendar_agent.memory_preferences import get_calendar_preferences
from foresight_x.calendar_agent.nl_parser import parse_calendar_intent
from foresight_x.calendar_agent.schemas import CalendarEvent, CalendarIntent, CalendarTask
from foresight_x.calendar_agent.scheduler import schedule_tasks_greedy, scheduler_options_from_preferences
from foresight_x.calendar_agent.store import list_events
from foresight_x.config import Settings
from foresight_x.schemas import UserProfile


def test_parse_planning_block_saturday_morning() -> None:
    intent = parse_calendar_intent(
        "Add a 30-minute planning block this Saturday morning",
        {},
        settings=Settings(openai_api_key=""),
        source="shadow_chat",
    )
    assert intent.intent_type == "create_event"
    assert intent.duration_minutes == 30 or intent.duration_minutes is None


def test_resolve_saturday_morning_utc() -> None:
    r = resolve_datetime_hints(
        date_hint="Saturday",
        time_hint="morning",
        user_timezone="UTC",
        now=datetime(2026, 5, 6, 12, 0, tzinfo=timezone.utc),
    )
    assert r.preferred_start_hour == 9
    assert r.window_start_local


def test_greedy_avoids_locked_event(tmp_path: Path) -> None:
    # Greedy scheduler uses naive UTC datetimes internally.
    locked_start = datetime(2026, 5, 11, 10, 0, 0).isoformat()
    locked_end = datetime(2026, 5, 11, 11, 0, 0).isoformat()
    existing = [
        CalendarEvent(
            id="busy",
            title="Busy",
            start=locked_start,
            end=locked_end,
            source="uploaded",
            locked=True,
        )
    ]
    tasks = [
        CalendarTask(
            id="t1",
            title="Task",
            duration_minutes=30,
            priority="high",
            source="manual",
        )
    ]
    opt = scheduler_options_from_preferences(None)
    placed, unsched = schedule_tasks_greedy(tasks, existing, opt)
    assert not unsched
    assert placed and placed[0].start != locked_start


def test_conflict_overlap_detected() -> None:
    e1 = CalendarEvent(
        id="a",
        title="A",
        start=datetime(2026, 5, 11, 9, 0, 0).isoformat(),
        end=datetime(2026, 5, 11, 10, 0, 0).isoformat(),
        source="ai_draft",
    )
    ex = [
        CalendarEvent(
            id="b",
            title="B",
            start=datetime(2026, 5, 11, 9, 30, 0).isoformat(),
            end=datetime(2026, 5, 11, 10, 30, 0).isoformat(),
            source="uploaded",
            locked=True,
        )
    ]
    c = detect_conflicts([e1], ex)
    assert any(x.type == "overlap" for x in c)


def test_confirm_replaces_prior_report_events_for_same_decision(tmp_path: Path) -> None:
    settings = Settings(foresight_user_id="u_rep", foresight_data_dir=tmp_path)
    decision_id = "dec-abc"
    intent = CalendarIntent(
        intent_type="schedule_tasks",
        source="decision_report",
        decision_id=decision_id,
        confidence=0.9,
    )
    draft = build_draft_from_intent(
        intent,
        settings=settings,
        user_id="u_rep",
        existing_events=[],
        tasks=[
            CalendarTask(
                id="t1",
                title="Ship MVP",
                duration_minutes=60,
                priority="high",
                source="decision_report",
                decision_id=decision_id,
            )
        ],
        user_timezone="UTC",
        now=datetime(2026, 5, 11, 8, 0, tzinfo=timezone.utc),
    )
    first, _ = confirm_draft(
        settings=settings,
        user_id="u_rep",
        draft_id=draft.draft_id,
        selected_event_ids=None,
        edits=None,
    )
    assert len(first) == 1

    draft2 = build_draft_from_intent(
        intent,
        settings=settings,
        user_id="u_rep",
        existing_events=list_events(settings, "u_rep"),
        tasks=[
            CalendarTask(
                id="t2",
                title="Review plan",
                duration_minutes=45,
                priority="medium",
                source="decision_report",
                decision_id=decision_id,
            )
        ],
        user_timezone="UTC",
        now=datetime(2026, 5, 11, 8, 0, tzinfo=timezone.utc),
    )
    second, _ = confirm_draft(
        settings=settings,
        user_id="u_rep",
        draft_id=draft2.draft_id,
        selected_event_ids=None,
        edits=None,
    )
    assert len(second) == 1
    stored = list_events(settings, "u_rep")
    assert len(stored) == 1
    assert stored[0].decision_id == decision_id


def test_confirm_persists_event(tmp_path: Path) -> None:
    settings = Settings(foresight_user_id="u_cal", foresight_data_dir=tmp_path)
    intent = CalendarIntent(intent_type="create_event", title="X", duration_minutes=30, source="manual", confidence=0.9)
    draft = build_draft_from_intent(
        intent,
        settings=settings,
        user_id="u_cal",
        existing_events=[],
        user_timezone="UTC",
        now=datetime(2026, 5, 11, 8, 0, tzinfo=timezone.utc),
    )
    confirmed, _ = confirm_draft(
        settings=settings,
        user_id="u_cal",
        draft_id=draft.draft_id,
        selected_event_ids=None,
        edits=None,
    )
    assert len(confirmed) == 1
    stored = list_events(settings, "u_cal")
    assert len(stored) >= 1


def test_user_isolation_store(tmp_path: Path) -> None:
    settings_a = Settings(foresight_user_id="a", foresight_data_dir=tmp_path)
    settings_b = Settings(foresight_user_id="b", foresight_data_dir=tmp_path)
    intent = CalendarIntent(intent_type="create_event", title="Private", duration_minutes=30, source="manual")
    draft = build_draft_from_intent(
        intent,
        settings=settings_a,
        user_id="a",
        existing_events=[],
        user_timezone="UTC",
        now=datetime(2026, 5, 11, 8, 0, tzinfo=timezone.utc),
    )
    confirm_draft(settings=settings_a, user_id="a", draft_id=draft.draft_id, selected_event_ids=None, edits=None)
    assert len(list_events(settings_b, "b")) == 0
    assert len(list_events(settings_a, "a")) >= 1


def test_memory_preferences_defaults() -> None:
    p = get_calendar_preferences("u", UserProfile(user_id="u"))
    assert p.defaults_only is True
    assert p.focus_time_preferences
