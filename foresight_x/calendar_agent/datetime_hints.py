"""Resolve natural date/time hints using timezone + preferences."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from foresight_x.calendar_agent.schemas import CalendarPreferences, ResolvedTimeHints


def resolve_datetime_hints(
    *,
    date_hint: str | None,
    time_hint: str | None,
    user_timezone: str,
    now: datetime,
    preferences: CalendarPreferences | None = None,
) -> ResolvedTimeHints:
    pref = preferences or CalendarPreferences()
    tz_name = (user_timezone or pref.timezone or "UTC").strip() or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
        tz_name = "UTC"

    if now.tzinfo is None:
        now = now.replace(tzinfo=ZoneInfo("UTC"))
    local = now.astimezone(tz)
    local_date = local.date()
    notes: list[str] = []

    low = f"{(date_hint or '').lower()} {(time_hint or '').lower()}".strip()

    # Next weekday / relative day (reuse logic similar to datetime_resolver)
    target = local_date
    if "today" in low:
        target = local_date
    elif "tomorrow" in low:
        target = local_date + timedelta(days=1)
    else:
        wd_map = {
            "monday": 0,
            "tuesday": 1,
            "wednesday": 2,
            "thursday": 3,
            "friday": 4,
            "saturday": 5,
            "sunday": 6,
        }
        prefer_next = "next" in low
        for name, wd in sorted(wd_map.items(), key=lambda kv: len(kv[0]), reverse=True):
            if name in low:
                delta = (wd - local_date.weekday()) % 7
                if prefer_next:
                    if delta == 0:
                        delta = 7
                    target = local_date + timedelta(days=delta)
                elif delta == 0:
                    target = local_date
                elif delta > 3:
                    target = local_date + timedelta(days=delta - 7)
                else:
                    target = local_date + timedelta(days=delta)
                break

    # Default windows
    start_h, end_h = 9, 12
    th = (time_hint or "").strip().lower()
    combined = low
    if th in ("morning", "am") or "morning" in combined:
        start_h, end_h = 9, 12
    elif th == "afternoon" or "afternoon" in combined:
        start_h, end_h = 13, 17
    elif th in ("evening", "pm") or "evening" in combined:
        start_h, end_h = 18, 21
    else:
        # Preference nudge: if user focuses morning, tighten morning window start
        if pref.focus_time_preferences and "morning" in [x.lower() for x in pref.focus_time_preferences]:
            start_h, end_h = 9, 11
            notes.append("Using narrower morning window from your focus preferences.")

    ws = datetime(target.year, target.month, target.day, start_h, 0, tzinfo=tz)
    we = datetime(target.year, target.month, target.day, end_h, 0, tzinfo=tz)
    return ResolvedTimeHints(
        window_start_local=ws.isoformat(),
        window_end_local=we.isoformat(),
        preferred_start_hour=start_h,
        preferred_end_hour=end_h,
        notes=notes,
    )
