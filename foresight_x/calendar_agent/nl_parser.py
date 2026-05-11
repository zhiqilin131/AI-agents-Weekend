"""Parse natural language into CalendarIntent (LLM + deterministic fallback)."""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.calendar_agent.schemas import CalendarIntent, CalendarSource, IntentType, TaskPriority
from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)


class _IntentLLM(BaseModel):
    intent_type: str = "unknown"
    title: str | None = None
    description: str | None = None
    date_hint: str | None = None
    time_hint: str | None = None
    duration_minutes: int | None = None
    deadline_hint: str | None = None
    priority: str | None = None
    flexibility: str | None = None
    can_split: bool | None = None
    confidence: float = 0.6


_PROMPT = """Parse the user's calendar-related message into structured fields.

User text:
{text}

Context (may be empty):
- thread_id: {thread_id}
- decision_id: {decision_id}
- current_event_id: {current_event_id}

intent_type must be one of:
create_event, schedule_tasks, reschedule, review_checkpoint, find_time, sync_calendar, unknown

Rules:
- "add / block / gym / meeting" → create_event with title and hints.
- "schedule (the) plan / execution plan / report / next steps" → schedule_tasks (set decision_id from context if user says "this report").
- "move / reschedule / another time / better time / less intense" → reschedule or find_time.
- "remind me ... review" → review_checkpoint.
- Extract duration_minutes when said (e.g. 30 minutes).
- date_hint: phrases like tomorrow, Saturday, next Friday.
- time_hint: morning, afternoon, evening, or clock times.
Return confidence 0-1.
"""


def _normalize_intent_type(raw: str) -> IntentType:
    x = (raw or "").strip().lower()
    allowed: set[str] = {
        "create_event",
        "schedule_tasks",
        "reschedule",
        "review_checkpoint",
        "find_time",
        "sync_calendar",
        "unknown",
    }
    return x if x in allowed else "unknown"  # type: ignore[return-value]


def _normalize_priority(raw: str | None) -> TaskPriority | None:
    if not raw:
        return None
    x = raw.strip().lower()
    if x in ("low", "medium", "high"):
        return x  # type: ignore[return-value]
    return None


def _fallback_parse(text: str, ctx: dict[str, Any]) -> CalendarIntent:
    t = (text or "").strip()
    low = t.lower()
    decision_id = ctx.get("decision_id")
    thread_id = ctx.get("thread_id")
    current_event_id = ctx.get("current_event_id")

    intent: IntentType = "unknown"
    if any(
        k in low
        for k in (
            "schedule the",
            "execution plan",
            "schedule my plan",
            "schedule the plan",
            "next steps on the calendar",
            "put the report",
        )
    ):
        intent = "schedule_tasks"
    elif any(k in low for k in ("better time", "another time", "find a slot", "find time")):
        intent = "find_time"
    elif any(k in low for k in ("move ", "reschedule", "push to", "shift to")):
        intent = "reschedule"
    elif "remind" in low and ("review" in low or "decision" in low):
        intent = "review_checkpoint"
    elif any(k in low for k in ("add ", "block", "put on my calendar", "schedule gym", "meeting")):
        intent = "create_event"
    elif low:
        intent = "create_event"

    dur: int | None = None
    m = re.search(r"\b(\d{1,3})\s*[- ]?min", low)
    if m:
        dur = max(5, min(int(m.group(1)), 480))

    date_hint = None
    for phrase in (
        "next friday",
        "next monday",
        "next tuesday",
        "next wednesday",
        "next thursday",
        "next saturday",
        "next sunday",
        "tomorrow",
        "today",
        "this saturday",
        "saturday",
        "sunday",
    ):
        if phrase in low:
            date_hint = phrase
            break

    time_hint = None
    if "morning" in low:
        time_hint = "morning"
    elif "afternoon" in low:
        time_hint = "afternoon"
    elif "evening" in low:
        time_hint = "evening"

    title = None
    if intent == "review_checkpoint":
        title = "Review decision"
    elif intent == "create_event":
        title = "Planning block"
        if "gym" in low:
            title = "Gym"

    return CalendarIntent(
        intent_type=intent,
        title=title,
        duration_minutes=dur,
        date_hint=date_hint,
        time_hint=time_hint,
        source="manual",
        thread_id=str(thread_id) if thread_id else None,
        decision_id=str(decision_id) if decision_id else None,
        current_event_id=str(current_event_id) if current_event_id else None,
        confidence=0.45,
    )


def parse_calendar_intent(
    text: str,
    context: dict[str, Any] | None = None,
    *,
    settings: Settings | None = None,
    source: CalendarSource = "manual",
    llm_model: str | None = None,
) -> CalendarIntent:
    ctx = dict(context or {})
    t = (text or "").strip()
    if not t:
        return CalendarIntent(intent_type="unknown", confidence=0.1, source=source)

    s = settings
    if s and (s.openai_api_key or "").strip():
        llm = build_openai_llm(s, temperature=0.05, model=llm_model)
        prompt = _PROMPT.format(
            text=t[:4000],
            thread_id=ctx.get("thread_id") or "",
            decision_id=ctx.get("decision_id") or "",
            current_event_id=ctx.get("current_event_id") or "",
        )
        try:
            raw = structured_predict(llm, _IntentLLM, prompt)
            flex = raw.flexibility
            if flex not in ("fixed", "flexible", "very_flexible", None):
                flex = None
            return CalendarIntent(
                intent_type=_normalize_intent_type(raw.intent_type),
                title=(raw.title or "").strip()[:200] or None,
                description=(raw.description or "").strip()[:500] or None,
                date_hint=(raw.date_hint or "").strip()[:120] or None,
                time_hint=(raw.time_hint or "").strip()[:80] or None,
                duration_minutes=raw.duration_minutes,
                deadline_hint=(raw.deadline_hint or "").strip()[:120] or None,
                priority=_normalize_priority(raw.priority),
                flexibility=flex,  # type: ignore[arg-type]
                can_split=raw.can_split,
                source=source,
                thread_id=str(ctx["thread_id"]) if ctx.get("thread_id") else None,
                decision_id=str(ctx["decision_id"]) if ctx.get("decision_id") else None,
                current_event_id=str(ctx["current_event_id"]) if ctx.get("current_event_id") else None,
                confidence=float(raw.confidence or 0.6),
            )
        except Exception as e:
            _log.warning("calendar intent LLM failed: %s", e)

    fb = _fallback_parse(t, ctx)
    fb.source = source
    return fb
