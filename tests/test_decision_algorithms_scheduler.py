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

