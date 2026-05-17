"""Orchestration: intent → draft → confirm."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from foresight_x.calendar_agent.conflict_detector import detect_conflicts, mark_event_conflicts
from foresight_x.calendar_agent.datetime_hints import resolve_datetime_hints
from foresight_x.calendar_agent.memory_preferences import get_calendar_preferences
from foresight_x.calendar_agent.scheduler import (
    build_alternatives,
    new_task_id,
    schedule_tasks_greedy,
    scheduler_options_from_preferences,
)
from foresight_x.calendar_agent.schemas import (
    CalendarDraft,
    CalendarEvent,
    CalendarIntent,
    CalendarTask,
    ScheduleAlternative,
)
from foresight_x.calendar_agent.store import get_draft, new_draft_id, put_draft, utc_now_iso
from foresight_x.calendar.datetime_resolver import resolve_calendar_draft
from foresight_x.config import Settings
from foresight_x.harness.trace import load_decision_trace
from foresight_x.profile.store import load_user_profile
from foresight_x.schemas import DecisionTrace, NextAction
from foresight_x.voice.calendar_command_parser import CalendarDraft as VoiceCalendarDraft

REPORT_EXECUTION_TASK_LIMIT = 4


def _trace_tasks(
    trace: DecisionTrace,
    *,
    decision_id: str,
    thread_id: str | None,
) -> list[CalendarTask]:
    tasks: list[CalendarTask] = []
    for i, na in enumerate(trace.recommendation.next_actions[:REPORT_EXECUTION_TASK_LIMIT]):
        dur = _infer_duration(na)
        pri: str = "high" if i == 0 else "medium"
        energy = _infer_energy(na.action)
        tasks.append(
            CalendarTask(
                id=new_task_id(),
                title=na.action[:200],
                description=None,
                duration_minutes=dur,
                priority=pri,  # type: ignore[arg-type]
                deadline=na.deadline,
                can_split=False,
                energy_type=energy,
                source="decision_report",
                decision_id=decision_id,
                thread_id=thread_id,
            )
        )
    return tasks


def _infer_duration(na: NextAction) -> int:
    low = na.action.lower()
    if any(x in low for x in ("review", "check", "email", "call")):
        return 30
    if any(x in low for x in ("deep", "write", "draft", "design")):
        return 90
    m = re.search(r"\b(\d{1,2})\s*h", low)
    if m:
        return min(480, max(15, int(m.group(1)) * 60))
    return 60


def _infer_energy(text: str) -> Any:
    low = text.lower()
    if any(x in low for x in ("write", "focus", "deep", "code", "design")):
        return "deep_work"
    if any(x in low for x in ("email", "admin", "form", "invoice")):
        return "admin"
    return None


def build_draft_from_intent(
    intent: CalendarIntent,
    *,
    settings: Settings,
    user_id: str,
    existing_events: list[CalendarEvent] | None = None,
    tasks: list[CalendarTask] | None = None,
    user_timezone: str = "UTC",
    now: datetime | None = None,
) -> CalendarDraft:
    pref = get_calendar_preferences(user_id, load_user_profile(settings))
    existing = list(existing_events or [])
    now = now or datetime.now(timezone.utc)
    expl_parts: list[str] = []
    if pref.defaults_only:
        expl_parts.append("Using default scheduling preferences (no dedicated calendar profile yet).")

    tlist = list(tasks or [])
    if tlist or intent.intent_type == "schedule_tasks":
        if intent.intent_type == "schedule_tasks" and not tlist:
            expl_parts.append("No tasks supplied — open from a decision report or pass tasks in the request.")
            cd = CalendarDraft(
                draft_id=new_draft_id(),
                intent=intent,
                tasks=[],
                proposed_events=[],
                conflicts=[],
                alternatives=[],
                requires_confirmation=True,
                explanation=" ".join(expl_parts) or "Nothing to schedule.",
                confidence=intent.confidence * 0.5,
                created_at=utc_now_iso(),
            )
            return put_draft(settings, user_id, cd)

        opt = scheduler_options_from_preferences(pref)
        proposed, unsched = schedule_tasks_greedy(
            tlist,
            existing,
            opt,
            decision_id=intent.decision_id,
            thread_id=intent.thread_id,
        )
        if unsched:
            expl_parts.append(f"Could not place {len(unsched)} task(s) — try widening the horizon or freeing time.")
        conflicts = detect_conflicts(proposed, existing, preferences=pref)
        proposed = mark_event_conflicts(proposed, conflicts)
        alts = build_alternatives(
            tlist,
            existing,
            pref,
            decision_id=intent.decision_id,
            thread_id=intent.thread_id,
        )
        expl_parts.append("Proposed schedule respects locked events and working hours where possible.")
        cd = CalendarDraft(
            draft_id=new_draft_id(),
            intent=intent,
            tasks=tlist,
            proposed_events=proposed,
            conflicts=conflicts,
            alternatives=alts,
            requires_confirmation=True,
            explanation=" ".join(expl_parts),
            confidence=intent.confidence,
            created_at=utc_now_iso(),
        )
        return put_draft(settings, user_id, cd)

    # create_event, review_checkpoint, find_time, reschedule → single block draft
    title = intent.title or ("Review decision" if intent.intent_type == "review_checkpoint" else "Planning block")
    dur = intent.duration_minutes
    if dur is None:
        dur = 30 if intent.intent_type == "review_checkpoint" else 60

    vd = VoiceCalendarDraft(
        title=title[:200],
        duration_minutes=dur,
        date_hint=intent.date_hint,
        time_hint=intent.time_hint,
        description=intent.description,
        timezone=user_timezone if user_timezone != "UTC" else None,
        confidence=intent.confidence,
    )
    resolved = resolve_calendar_draft(vd, user_timezone=user_timezone, now=now)
    hint_notes = resolve_datetime_hints(
        date_hint=intent.date_hint,
        time_hint=intent.time_hint,
        user_timezone=user_timezone,
        now=now,
        preferences=pref,
    )
    if hint_notes.notes:
        expl_parts.extend(hint_notes.notes)

    ev = CalendarEvent(
        id=f"draft-{uuid.uuid4().hex[:10]}",
        title=resolved.title,
        start=resolved.start_iso,
        end=resolved.end_iso,
        description=intent.description or resolved.ambiguity_note,
        source="ai_draft",
        locked=False,
        conflict=False,
        decision_id=intent.decision_id,
        thread_id=intent.thread_id,
        metadata={"display_summary": resolved.display_summary, "timezone": resolved.timezone},
    )
    conflicts = detect_conflicts([ev], existing, preferences=pref)
    ev_marked = mark_event_conflicts([ev], conflicts)[0]

    alts: list[ScheduleAlternative] = []
    if conflicts:
        # Suggest sliding by 1h if overlap
        try:
            from datetime import timedelta

            s = datetime.fromisoformat(ev_marked.start.replace("Z", "+00:00"))
            e = datetime.fromisoformat(ev_marked.end.replace("Z", "+00:00"))
            shifted = CalendarEvent(
                id=f"draft-alt-{uuid.uuid4().hex[:8]}",
                title=ev_marked.title,
                start=(s + timedelta(hours=1)).isoformat(),
                end=(e + timedelta(hours=1)).isoformat(),
                description=ev_marked.description,
                source="ai_draft",
                decision_id=intent.decision_id,
                thread_id=intent.thread_id,
                metadata={"label": "+1 hour"},
            )
            c2 = detect_conflicts([shifted], existing, preferences=pref)
            if not any(x.type == "overlap" for x in c2):
                alts.append(
                    ScheduleAlternative(
                        label="One hour later",
                        proposed_events=[shifted],
                        score=0.65,
                        tradeoff_summary="Avoids the first conflict window.",
                    )
                )
        except ValueError:
            pass

    expl_parts.append(resolved.display_summary)
    if resolved.ambiguity_note:
        expl_parts.append(resolved.ambiguity_note)

    cd = CalendarDraft(
        draft_id=new_draft_id(),
        intent=intent,
        tasks=[],
        proposed_events=[ev_marked],
        conflicts=conflicts,
        alternatives=alts,
        requires_confirmation=True,
        explanation=" ".join(expl_parts),
        confidence=float(intent.confidence),
        created_at=utc_now_iso(),
    )
    return put_draft(settings, user_id, cd)


def draft_from_report(
    *,
    settings: Settings,
    user_id: str,
    decision_id: str,
    thread_id: str | None,
    existing_events: list[CalendarEvent] | None = None,
) -> CalendarDraft:
    trace = load_decision_trace(decision_id, settings=settings)
    tasks = _trace_tasks(trace, decision_id=decision_id, thread_id=thread_id)
    intent = CalendarIntent(
        intent_type="schedule_tasks",
        source="decision_report",
        decision_id=decision_id,
        thread_id=thread_id,
        confidence=0.85,
    )
    return build_draft_from_intent(
        intent,
        settings=settings,
        user_id=user_id,
        existing_events=existing_events,
        tasks=tasks,
    )


def alternatives_for_draft(
    *,
    settings: Settings,
    user_id: str,
    draft_id: str,
    preference: str,
) -> list[ScheduleAlternative]:
    d = get_draft(settings, user_id, draft_id)
    if not d:
        return []
    pref = get_calendar_preferences(user_id, load_user_profile(settings))
    if preference == "earlier":
        opt = scheduler_options_from_preferences(pref, earlier=True)
    elif preference == "less_intense":
        opt = scheduler_options_from_preferences(pref, spread=True)
    elif preference == "later":
        opt = scheduler_options_from_preferences(pref)
        opt = opt.model_copy(update={"day_start_hour": min(11, opt.day_start_hour + 1)})
    elif preference == "focus_time":
        opt = scheduler_options_from_preferences(pref)
        if "morning" in [x.lower() for x in pref.focus_time_preferences]:
            opt = opt.model_copy(update={"day_start_hour": 9, "day_end_hour": 12})
    else:
        opt = scheduler_options_from_preferences(pref)

    if d.tasks:
        proposed, _ = schedule_tasks_greedy(
            d.tasks,
            [],  # re-starts from open canvas for alternative generation
            opt,
            decision_id=d.intent.decision_id,
            thread_id=d.intent.thread_id,
        )
        label = {"earlier": "Earlier day", "less_intense": "Spread out", "later": "Later start", "focus_time": "Focus window"}.get(
            preference,
            "Alternative",
        )
        return [
            ScheduleAlternative(
                label=label,
                proposed_events=proposed,
                score=0.7,
                tradeoff_summary="Generated from your preference — confirm to apply.",
            )
        ]
    return d.alternatives


def confirm_draft(
    *,
    settings: Settings,
    user_id: str,
    draft_id: str,
    selected_event_ids: list[str] | None,
    edits: list[dict[str, Any]] | None,
) -> tuple[list[CalendarEvent], CalendarDraft | None]:
    d = get_draft(settings, user_id, draft_id)
    if not d:
        return [], None
    chosen = d.proposed_events
    if selected_event_ids:
        sel = set(selected_event_ids)
        chosen = [e for e in chosen if e.id in sel]
    edit_by_id = {str(x.get("id")): x for x in (edits or []) if x.get("id")}
    confirmed: list[CalendarEvent] = []
    for e in chosen:
        patch = edit_by_id.get(e.id, {})
        start = str(patch.get("start", e.start))
        end = str(patch.get("end", e.end))
        title = str(patch.get("title", e.title))[:200]
        ce = CalendarEvent(
            id=f"evt-{uuid.uuid4().hex[:12]}",
            title=title,
            start=start,
            end=end,
            description=e.description,
            source="confirmed",
            locked=False,
            conflict=False,
            decision_id=e.decision_id,
            thread_id=e.thread_id,
            metadata={**(e.metadata or {}), "from_draft_id": draft_id},
        )
        confirmed.append(ce)

    from foresight_x.calendar_agent import store as cal_store

    replace_decision_id = (d.intent.decision_id or "").strip() or None
    lk = cal_store._user_lock(user_id)
    with lk:
        d2 = cal_store.load_store(settings, user_id)
        if replace_decision_id:
            d2.events = [e for e in d2.events if (e.decision_id or "").strip() != replace_decision_id]
        d2.events.extend(confirmed)
        d2.drafts.pop(draft_id, None)
        cal_store.save_store(settings, user_id, d2)

    d_final = d.model_copy(update={"status": "confirmed"})
    return confirmed, d_final
