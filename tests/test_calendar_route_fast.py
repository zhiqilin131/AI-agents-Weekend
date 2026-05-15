"""Fast calendar routing on execution planner."""

from __future__ import annotations

from foresight_x.voice.calendar_route_fast import try_fast_calendar_on_execution


def test_execution_add_date_routes_to_create_draft() -> None:
    r = try_fast_calendar_on_execution(
        "Can you please add a date on Thursday morning 3 a.m. and hang out with my hamster",
        current_route="/execution",
    )
    assert r is not None
    assert r.tool_name == "create_calendar_draft"
    assert r.arguments.get("_fast_parse") is True


def test_execution_calendar_reschedule_not_fast_create() -> None:
    r = try_fast_calendar_on_execution(
        "Move my standup on the calendar to 3pm tomorrow",
        current_route="/execution",
    )
    assert r is None


def test_buddy_add_gym_event_routes_to_create_draft() -> None:
    from foresight_x.voice.calendar_route_fast import try_fast_calendar_create

    r = try_fast_calendar_create(
        "Hi, can we add a gym event on Monday night 10 p.m. next week",
        current_route="/buddy",
    )
    assert r is not None
    assert r.tool_name == "create_calendar_draft"
    assert r.arguments.get("_fast_parse") is True
