"""Calendar draft date/time resolution and regex parsing."""

from __future__ import annotations

from datetime import datetime, timezone

from foresight_x.calendar.datetime_resolver import resolve_calendar_draft
from foresight_x.voice.calendar_command_parser import _regex_fallback, parse_calendar_command


def test_friday_thursday_resolves_to_previous_thursday() -> None:
    draft = _regex_fallback(
        "Can you please add a date on Thursday morning 3 a.m. and hang out with my hamster",
    )
    assert draft.date_hint == "thursday"
    assert draft.time_hint == "3am"
    assert "hamster" in draft.title.lower()

    now = datetime(2026, 5, 15, 10, 0, tzinfo=timezone.utc)  # Friday
    r = resolve_calendar_draft(draft, user_timezone="UTC", now=now)
    assert "Thursday" in r.display_summary
    assert "3:00 AM" in r.display_summary
    assert r.title.lower() != "date"


def test_explicit_3am_overrides_morning_default() -> None:
    draft = _regex_fallback("add gym Thursday morning at 3 am")
    assert draft.time_hint == "3am"
    now = datetime(2026, 5, 15, 10, 0, tzinfo=timezone.utc)
    r = resolve_calendar_draft(draft, user_timezone="UTC", now=now)
    assert "3:00 AM" in r.display_summary


def test_prefer_regex_thursday_from_execution_phrase() -> None:
    d = parse_calendar_command(
        "add a date on Thursday 3 a.m.",
        settings=None,
        prefer_regex=True,
    )
    assert d.date_hint == "thursday"
    assert d.time_hint == "3am"
