"""Fast routing for calendar voice commands (execution planner and Slime Buddy)."""

from __future__ import annotations

import re

from foresight_x.voice.slime_voice_router import SlimeVoiceRouteResult

_SLIME_CALENDAR_ROUTES = frozenset(
    {
        "execution",
        "execution_calendar",
        "planner",
        "calendar",
        "buddy",
        "slime",
        "slime_buddy",
        "companion",
        "home",
    }
)


def _normalize_route(current_route: str | None) -> str:
    r = (current_route or "").strip().lower().rstrip("/")
    if r.startswith("/"):
        r = r[1:]
    return r


def is_execution_calendar_route(current_route: str | None) -> bool:
    return _normalize_route(current_route) in ("execution", "execution_calendar", "planner", "calendar")


def is_slime_calendar_voice_route(current_route: str | None) -> bool:
    return _normalize_route(current_route) in _SLIME_CALENDAR_ROUTES


def transcript_looks_like_calendar_create(transcript: str) -> bool:
    """True when the user is likely asking to add/schedule an event (no word 'calendar' required)."""
    raw = (transcript or "").strip()
    if not raw or len(raw) > 900:
        return False
    low = raw.lower()

    if re.search(r"\b(delete|remove|cancel)\b", low) or re.search(r"删除|取消|移除", raw):
        return False
    if re.search(r"\b(change|edit|update|move|reschedule)\b", low) and re.search(
        r"\b(event|appointment|meeting|block)\b", low
    ):
        return False

    search_like = bool(
        re.search(
            r"\b(what do i have|what's on|whats on|am i free|show my|list my)\b",
            low,
        )
    ) or bool(re.search(r"有什么|有空吗|日程", raw))
    if search_like:
        return False

    create_like = bool(
        re.search(
            r"\b(add|schedule|book|put|create|set up|remind|plan|save|can we add)\b",
            low,
        )
        or re.search(r"加入|安排|添加|订|记到|保存", raw)
        or re.search(r"\badd a date\b", low)
    )
    time_like = bool(
        re.search(
            r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b",
            low,
        )
        or re.search(r"\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", low)
        or re.search(r"\b(morning|afternoon|evening|night)\b", low)
        or re.search(r"\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b", low)
        or re.search(r"周[一二三四五六日天]|明天|后天|早上|下午|晚上", raw)
    )
    hangout_like = bool(
        re.search(r"\b(hang|hangout|meet|meeting|event|date|gym|hamster|workout|appointment)\b", low)
    )

    return bool(create_like or (time_like and hangout_like) or (time_like and "date" in low))


def try_fast_calendar_create(
    transcript: str,
    *,
    current_route: str | None,
) -> SlimeVoiceRouteResult | None:
    """
    On /execution or /buddy, bias add/schedule utterances to create_calendar_draft (not generic chat).
    User may say "add a gym event Monday 10pm" without the word "calendar".
    """
    if not is_slime_calendar_voice_route(current_route):
        return None
    if not transcript_looks_like_calendar_create(transcript):
        return None

    return SlimeVoiceRouteResult(
        intent="calendar_create",
        tool_name="create_calendar_draft",
        arguments={"_fast_parse": True},
        requires_confirmation=False,
        assistant_hint=None,
    )


def try_fast_calendar_on_execution(
    transcript: str,
    *,
    current_route: str | None,
) -> SlimeVoiceRouteResult | None:
    """Backward-compatible alias used by tests and older imports."""
    return try_fast_calendar_create(transcript, current_route=current_route)
