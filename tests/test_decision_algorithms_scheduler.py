from datetime import datetime

import foresight_x.decision_algorithms.scheduler as scheduler_mod
from foresight_x.decision_algorithms.scheduler import schedule_greedy_earliest_fit, schedule_with_ortools
from foresight_x.decision_algorithms.schemas import CalendarEvent, ExecutionTask, SchedulerOptions


def _sample():
    events = [
        CalendarEvent(
            id="e1",
            title="Class",
            start="2026-05-08T10:00:00",
            end="2026-05-08T11:30:00",
            source="uploaded",
            locked=True,
        ),
        CalendarEvent(
            id="e2",
            title="Meeting",
            start="2026-05-08T14:00:00",
            end="2026-05-08T15:00:00",
            source="uploaded",
            locked=True,
        ),
    ]
    tasks = [
        ExecutionTask(id="t1", title="Clarify requirements", duration_minutes=45, priority="high"),
        ExecutionTask(id="t2", title="Email stakeholder", duration_minutes=30, priority="medium"),
    ]
    opts = SchedulerOptions(day_start_hour=9, day_end_hour=22, days=2, slot_minutes=30)
    return tasks, events, opts


def test_greedy_scheduler_no_overlap():
    tasks, events, opts = _sample()
    out = schedule_greedy_earliest_fit(tasks, events, opts)
    assert len(out.scheduled_events) >= 1
    for s in out.scheduled_events:
        for e in events:
            assert not (s.start < e.end and s.end > e.start)


def test_ortools_scheduler_fallback_still_no_overlap():
    tasks, events, opts = _sample()
    out = schedule_with_ortools(tasks, events, opts)
    for s in out.scheduled_events:
        for e in events:
            assert not (s.start < e.end and s.end > e.start)


def test_unschedulable_task_returns_warning():
    events = [
        CalendarEvent(
            id="busy",
            title="Busy",
            start="2026-05-08T09:00:00",
            end="2026-05-08T22:00:00",
            source="uploaded",
            locked=True,
        )
    ]
    tasks = [ExecutionTask(id="t1", title="Long task", duration_minutes=120, priority="high")]
    opts = SchedulerOptions(day_start_hour=9, day_end_hour=22, days=1, slot_minutes=30)
    out = schedule_greedy_earliest_fit(tasks, events, opts)
    assert out.unscheduled_tasks
    assert out.warnings


def test_max_ai_blocks_per_day_spreads_placements(monkeypatch):
    """Greedy scheduler must not place more than N new AI blocks on the same calendar day."""

    class _FixedDateTime:
        @staticmethod
        def utcnow():
            return datetime(2026, 5, 8, 12, 0, 0)

        fromisoformat = staticmethod(datetime.fromisoformat)

    monkeypatch.setattr(scheduler_mod, "datetime", _FixedDateTime)

    tasks = [
        ExecutionTask(id=f"t{i}", title=f"Task {i}", duration_minutes=60, priority="medium")
        for i in range(6)
    ]
    opts = SchedulerOptions(
        day_start_hour=9,
        day_end_hour=22,
        days=7,
        slot_minutes=60,
        max_ai_blocks_per_day=2,
    )
    out = schedule_greedy_earliest_fit(tasks, [], opts)
    assert len(out.scheduled_events) == 6
    from collections import Counter

    by_day = Counter(ev.start[:10] for ev in out.scheduled_events)
    assert max(by_day.values()) <= 2


def test_allowed_weekdays_saturday_only(monkeypatch):
    class _FixedDateTime:
        @staticmethod
        def utcnow():
            return datetime(2026, 5, 11, 12, 0, 0)

        fromisoformat = staticmethod(datetime.fromisoformat)

    monkeypatch.setattr(scheduler_mod, "datetime", _FixedDateTime)

    tasks = [ExecutionTask(id="t1", title="Deep work", duration_minutes=60, priority="medium")]
    opts = SchedulerOptions(
        day_start_hour=9,
        day_end_hour=22,
        days=7,
        slot_minutes=60,
        allowed_weekdays=[5],
    )
    out = schedule_greedy_earliest_fit(tasks, [], opts)
    assert len(out.scheduled_events) == 1
    assert "2026-05-16" in out.scheduled_events[0].start
    assert datetime.fromisoformat(out.scheduled_events[0].start.replace("Z", "+00:00")).weekday() == 5

