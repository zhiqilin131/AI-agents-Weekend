"""Derive calendar preferences from profile — never invent specifics without evidence."""

from __future__ import annotations

import re

from foresight_x.calendar_agent.schemas import CalendarPreferences
from foresight_x.schemas import UserProfile


def _scan_text_for_hints(text: str) -> tuple[list[str], list[str], list[str]]:
    """Return (focus_hints, avoid_hints, notes) from free text."""
    low = text.lower()
    focus: list[str] = []
    avoid: list[str] = []
    notes: list[str] = []
    if any(x in low for x in ("morning person", "early bird", "focus in the morning", "work best morning")):
        focus.append("morning")
        notes.append("Profile text suggests morning focus")
    if any(x in low for x in ("night owl", "late night", "evening focus", "work late")):
        focus.append("late afternoon")
        notes.append("Profile text suggests later-day focus")
    if any(x in low for x in ("avoid late night", "no late nights", "sleep early", "not a night person")):
        avoid.append("late night")
    if any(x in low for x in ("deep work", "focus block", "no meetings morning")):
        notes.append("Mentions deep work / focus blocks")
    return focus, avoid, notes


def get_calendar_preferences(user_id: str, profile: UserProfile | None) -> CalendarPreferences:
    """Build preferences from profile facts and about_me; label defaults when nothing found."""
    _ = user_id
    defaults_only = True
    focus: list[str] = []
    avoid: list[str] = []
    notes: list[str] = []
    tz = "UTC"

    chunks: list[str] = []
    if profile and profile.about_me:
        chunks.append(profile.about_me)
    if profile and profile.memory_facts:
        for f in profile.memory_facts[:40]:
            t = getattr(f, "text", None) or str(f)
            if t:
                chunks.append(t)
    if profile and profile.priority_lines:
        for pl in profile.priority_lines[:20]:
            t = getattr(pl, "text", None) or str(pl)
            if t:
                chunks.append(t)

    blob = " \n".join(chunks)
    if blob.strip():
        f, a, n = _scan_text_for_hints(blob)
        if f or a or n:
            defaults_only = False
        focus.extend(f)
        avoid.extend(a)
        notes.extend(n)

    # Lightweight timezone mention (e.g. "PST", "Tokyo") — best-effort only
    if profile and profile.about_me:
        m = re.search(r"\b(UTC|GMT|EST|PST|CST|JST|CET|BST)\b", profile.about_me, re.I)
        if m:
            tz = m.group(1).upper()
            defaults_only = False

    if not focus:
        focus = ["morning", "late afternoon"]
    if not avoid:
        avoid = ["late night"]

    return CalendarPreferences(
        timezone=tz,
        working_hours={"start": "09:00", "end": "22:00"},
        focus_time_preferences=focus[:6],
        avoid_times=avoid[:6],
        buffer_minutes=10,
        max_daily_deep_work_hours=4,
        preferred_chunk_minutes=60,
        energy_pattern_notes=notes[:8],
        defaults_only=defaults_only,
    )
