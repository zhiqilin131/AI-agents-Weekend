"""Resolve natural date/time hints into concrete ISO intervals (draft / confirmation only)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from foresight_x.voice.calendar_command_parser import CalendarDraft

_WD = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}


class ResolvedCalendarDraft(BaseModel):
    title: str
    start_iso: str
    end_iso: str
    duration_minutes: int
    display_summary: str
    requires_confirmation: bool = True
    ambiguity_note: str | None = None
    timezone: str = "UTC"


def _local_now(now: datetime, tz: ZoneInfo) -> datetime:
    if now.tzinfo is None:
        now = now.replace(tzinfo=ZoneInfo("UTC"))
    return now.astimezone(tz)


def _default_duration_minutes(title: str, explicit: int | None) -> int:
    if explicit is not None:
        return max(5, min(int(explicit), 480))
    low = title.lower()
    if any(k in low for k in ("review", "checkpoint", "planning")):
        return 30
    return 60


def _time_from_hint(time_hint: str | None, low_date_hint: str) -> tuple[int, int]:
    if not time_hint:
        if "afternoon" in low_date_hint:
            return 14, 0
        if "evening" in low_date_hint:
            return 18, 0
        if "morning" in low_date_hint:
            return 9, 0
        return 9, 0
    th = time_hint.strip().lower()
    if th in ("morning", "am"):
        return 9, 0
    if th in ("afternoon",):
        return 14, 0
    if th in ("evening", "pm"):
        return 18, 0
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", th)
    if m:
        h = int(m.group(1))
        minute = int(m.group(2) or 0)
        ap = m.group(3)
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        return h, minute
    m2 = re.search(r"(\d{1,2})(?::(\d{2}))?", th)
    if m2:
        return int(m2.group(1)), int(m2.group(2) or 0)
    return 9, 0


def _resolve_day(local_date: date, hint: str | None) -> date:
    if not hint:
        return local_date
    h = hint.strip().lower()
    today = local_date
    if "today" in h:
        return today
    if "tomorrow" in h:
        return today + timedelta(days=1)
    if "yesterday" in h:
        return today - timedelta(days=1)

    prefer_next = "next" in h
    for name, wd in sorted(_WD.items(), key=lambda kv: len(kv[0]), reverse=True):
        if name in h:
            delta = (wd - today.weekday()) % 7
            if prefer_next and delta == 0:
                delta = 7
            return today + timedelta(days=delta)
    return today


def resolve_calendar_draft(
    draft: CalendarDraft,
    *,
    user_timezone: str,
    now: datetime,
) -> ResolvedCalendarDraft:
    tz_name = (draft.timezone or user_timezone or "UTC").strip() or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
        tz_name = "UTC"

    local = _local_now(now, tz)
    local_d = local.date()
    low_hint = (draft.date_hint or "").lower() + " " + (draft.time_hint or "").lower()

    target_day = _resolve_day(local_d, draft.date_hint)
    hour, minute = _time_from_hint(draft.time_hint, low_hint)
    start_local = datetime(
        target_day.year,
        target_day.month,
        target_day.day,
        hour,
        minute,
        tzinfo=tz,
    )
    dur = _default_duration_minutes(draft.title, draft.duration_minutes)
    end_local = start_local + timedelta(minutes=dur)
    start_iso = start_local.isoformat()
    end_iso = end_local.isoformat()

    def _fmt_clock(dt: datetime) -> str:
        return dt.strftime("%I:%M %p").lstrip("0").replace("  ", " ")

    display = f"{target_day.strftime('%A')}, {_fmt_clock(start_local)}–{_fmt_clock(end_local)}"

    ambiguity: str | None = None
    if not draft.date_hint and not draft.time_hint:
        ambiguity = "I assumed today at 9:00 — adjust if that’s wrong."

    return ResolvedCalendarDraft(
        title=draft.title[:200],
        start_iso=start_iso,
        end_iso=end_iso,
        duration_minutes=dur,
        display_summary=display,
        requires_confirmation=True,
        ambiguity_note=ambiguity,
        timezone=tz_name,
    )
