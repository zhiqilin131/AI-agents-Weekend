from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from foresight_x.decision_algorithms.schemas import CalendarEvent, ExecutionTask, ScheduleResult, SchedulerOptions


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _overlap(a_s: datetime, a_e: datetime, b_s: datetime, b_e: datetime) -> bool:
    return a_s < b_e and a_e > b_s


def schedule_greedy_earliest_fit(
    tasks: list[ExecutionTask],
    existing_events: list[CalendarEvent],
    options: SchedulerOptions,
) -> ScheduleResult:
    start = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    blocked = [(_parse_iso(e.start), _parse_iso(e.end)) for e in existing_events]
    scheduled: list[CalendarEvent] = []
    unscheduled: list[ExecutionTask] = []
    warnings: list[str] = []

    def sort_key(t: ExecutionTask):
        pri = {"high": 0, "medium": 1, "low": 2}.get(t.priority, 1)
        deadline = t.deadline_hint or "zzzz"
        return (pri, deadline, -t.duration_minutes)

    for t in sorted(tasks, key=sort_key):
        placed = False
        dur = timedelta(minutes=max(options.slot_minutes, t.duration_minutes))
        for d in range(options.days):
            day = (start + timedelta(days=d)).replace(hour=options.day_start_hour, minute=0, second=0, microsecond=0)
            end_window = day.replace(hour=options.day_end_hour, minute=0)
            cur = day
            while cur + dur <= end_window:
                cand_s, cand_e = cur, cur + dur
                if all(not _overlap(cand_s, cand_e, b_s, b_e) for b_s, b_e in blocked):
                    ev = CalendarEvent(
                        id=f"ai-{t.id}",
                        title=t.title,
                        start=cand_s.isoformat(),
                        end=cand_e.isoformat(),
                        source="ai",
                        description=t.description,
                        locked=False,
                    )
                    scheduled.append(ev)
                    blocked.append((cand_s, cand_e))
                    placed = True
                    break
                cur += timedelta(minutes=options.slot_minutes)
            if placed:
                break
        if not placed:
            unscheduled.append(t)
            warnings.append(f"Unable to schedule task: {t.title}")

    return ScheduleResult(scheduled_events=scheduled, unscheduled_tasks=unscheduled, warnings=warnings)


def schedule_with_ortools(
    tasks: list[ExecutionTask],
    existing_events: list[CalendarEvent],
    options: SchedulerOptions,
) -> ScheduleResult:
    """Use OR-Tools if available; fallback to greedy."""
    try:
        from ortools.sat.python import cp_model  # type: ignore # noqa: F401
    except Exception:
        return schedule_greedy_earliest_fit(tasks, existing_events, options)
    # For current scope keep deterministic fallback behavior even when ortools exists.
    # TODO: replace with full CP-SAT formulation (lateness + fragmentation objective).
    return schedule_greedy_earliest_fit(tasks, existing_events, options)

