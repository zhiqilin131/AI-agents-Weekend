"""Task scheduling: greedy MVP + optional OR-Tools (time-limited)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from foresight_x.calendar_agent.schemas import CalendarEvent, CalendarPreferences, CalendarTask, ScheduleAlternative
from foresight_x.decision_algorithms.scheduler import schedule_greedy_earliest_fit, schedule_with_ortools
from foresight_x.decision_algorithms.schemas import CalendarEvent as AlgoEvent
from foresight_x.decision_algorithms.schemas import ExecutionTask as AlgoTask
from foresight_x.decision_algorithms.schemas import SchedulerOptions


def _algo_tasks(tasks: list[CalendarTask]) -> list[AlgoTask]:
    out: list[AlgoTask] = []
    for t in tasks:
        out.append(
            AlgoTask(
                id=t.id,
                title=t.title,
                duration_minutes=t.duration_minutes,
                description=t.description or "",
                priority=t.priority,
                deadline_hint=t.deadline,
                linked_option_id=None,
            )
        )
    return out


def _algo_events(events: list[CalendarEvent]) -> list[AlgoEvent]:
    out: list[AlgoEvent] = []
    for e in events:
        src = e.source
        if src == "ai_draft":
            asrc = "ai"
        elif src == "confirmed":
            asrc = "manual"
        else:
            asrc = src if src in ("uploaded", "ai", "manual") else "manual"
        out.append(
            AlgoEvent(
                id=e.id,
                title=e.title,
                start=e.start,
                end=e.end,
                source=asrc,  # type: ignore[arg-type]
                description=e.description or "",
                locked=e.locked,
                conflict=e.conflict,
            )
        )
    return out


def _from_algo(ev: AlgoEvent, *, decision_id: str | None, thread_id: str | None) -> CalendarEvent:
    src: str = ev.source
    if src == "ai":
        mapped = "ai_draft"
    else:
        mapped = src if src in ("uploaded", "manual") else "manual"
    return CalendarEvent(
        id=ev.id,
        title=ev.title,
        start=ev.start,
        end=ev.end,
        description=ev.description or None,
        source=mapped,  # type: ignore[arg-type]
        locked=ev.locked,
        conflict=ev.conflict,
        decision_id=decision_id,
        thread_id=thread_id,
        metadata={},
    )


def scheduler_options_from_preferences(
    pref: CalendarPreferences | None,
    *,
    spread: bool = False,
    earlier: bool = False,
) -> SchedulerOptions:
    pref = pref or CalendarPreferences()
    wh_start = 9
    wh_end = 22
    try:
        wh_start = int(str(pref.working_hours.get("start", "09:00")).split(":")[0])
    except (ValueError, IndexError):
        pass
    try:
        wh_end = int(str(pref.working_hours.get("end", "22:00")).split(":")[0])
    except (ValueError, IndexError):
        pass
    if earlier:
        wh_start = max(6, wh_start - 1)
    gap = pref.buffer_minutes
    max_per = 0
    if spread:
        max_per = 2
    return SchedulerOptions(
        day_start_hour=wh_start,
        day_end_hour=wh_end,
        days=10 if spread else 7,
        slot_minutes=30,
        min_gap_minutes=max(5, gap),
        max_ai_blocks_per_day=max_per,
    )


def schedule_tasks_greedy(
    tasks: list[CalendarTask],
    existing_events: list[CalendarEvent],
    options: SchedulerOptions,
    *,
    decision_id: str | None = None,
    thread_id: str | None = None,
) -> tuple[list[CalendarEvent], list[CalendarTask]]:
    """Returns (proposed events, unscheduled tasks)."""
    if not tasks:
        return [], []
    res = schedule_greedy_earliest_fit(_algo_tasks(tasks), _algo_events(existing_events), options)
    proposed = [_from_algo(e, decision_id=decision_id, thread_id=thread_id) for e in res.scheduled_events]
    unsched_ids = {t.id for t in res.unscheduled_tasks}
    unsched = [t for t in tasks if t.id in unsched_ids]
    return proposed, unsched


def schedule_tasks_ortools(
    tasks: list[CalendarTask],
    existing_events: list[CalendarEvent],
    preferences: CalendarPreferences | None,
    options: SchedulerOptions | None = None,
    *,
    decision_id: str | None = None,
    thread_id: str | None = None,
) -> tuple[list[CalendarEvent], list[CalendarTask]]:
    """Same as greedy today: OR-Tools path is shared with decision_algorithms (still greedy fallback)."""
    opt = options or scheduler_options_from_preferences(preferences)
    res = schedule_with_ortools(_algo_tasks(tasks), _algo_events(existing_events), opt)
    proposed = [_from_algo(e, decision_id=decision_id, thread_id=thread_id) for e in res.scheduled_events]
    unsched_ids = {t.id for t in res.unscheduled_tasks}
    unsched = [t for t in tasks if t.id in unsched_ids]
    return proposed, unsched


def build_alternatives(
    tasks: list[CalendarTask],
    existing: list[CalendarEvent],
    pref: CalendarPreferences | None,
    *,
    decision_id: str | None,
    thread_id: str | None,
) -> list[ScheduleAlternative]:
    """Produce a few labeled schedule variants."""
    alts: list[ScheduleAlternative] = []
    base_opt = scheduler_options_from_preferences(pref)
    p1, u1 = schedule_tasks_greedy(tasks, existing, base_opt, decision_id=decision_id, thread_id=thread_id)
    alts.append(
        ScheduleAlternative(
            label="Balanced",
            proposed_events=p1,
            score=0.8,
            tradeoff_summary="Default working hours and spacing.",
        )
    )
    opt_early = scheduler_options_from_preferences(pref, earlier=True)
    p2, _ = schedule_tasks_greedy(tasks, existing, opt_early, decision_id=decision_id, thread_id=thread_id)
    if p2 != p1:
        alts.append(
            ScheduleAlternative(
                label="Earlier",
                proposed_events=p2,
                score=0.72,
                tradeoff_summary="Slightly earlier day start if you want headroom.",
            )
        )
    opt_spread = scheduler_options_from_preferences(pref, spread=True)
    p3, _ = schedule_tasks_greedy(tasks, existing, opt_spread, decision_id=decision_id, thread_id=thread_id)
    if p3 != p1:
        alts.append(
            ScheduleAlternative(
                label="Less intense",
                proposed_events=p3,
                score=0.75,
                tradeoff_summary="Caps blocks per day to spread workload.",
            )
        )
    # de-dupe by serialized starts
    seen: set[str] = set()
    unique: list[ScheduleAlternative] = []
    for a in alts:
        key = ",".join(f"{e.start}|{e.end}" for e in a.proposed_events)
        if key in seen:
            continue
        seen.add(key)
        unique.append(a)
    return unique[:3]


def choose_best_schedule(candidates: list[ScheduleAlternative]) -> ScheduleAlternative | None:
    if not candidates:
        return None
    return max(candidates, key=lambda c: c.score)


def new_task_id() -> str:
    return f"ct-{uuid.uuid4().hex[:10]}"
