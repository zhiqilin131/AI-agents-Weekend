"""Google Calendar provider — OAuth + API not wired yet."""

from __future__ import annotations

from typing import Any, Protocol


class CalendarProvider(Protocol):
    def list_events(self, start: str, end: str) -> list[dict[str, Any]]: ...
    def get_freebusy(self, start: str, end: str) -> dict[str, Any]: ...
    def create_event(self, event: dict[str, Any]) -> dict[str, Any]: ...
    def update_event(self, event: dict[str, Any]) -> dict[str, Any]: ...
    def delete_event(self, event_id: str) -> bool: ...


class GoogleCalendarProvider:
    """TODO: OAuth2 + Google Calendar API (events.insert, freebusy.query)."""

    def list_events(self, start: str, end: str) -> list[dict[str, Any]]:
        raise NotImplementedError("Google Calendar integration requires OAuth setup")

    def get_freebusy(self, start: str, end: str) -> dict[str, Any]:
        raise NotImplementedError("Google Calendar integration requires OAuth setup")

    def create_event(self, event: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError("Google Calendar integration requires OAuth setup")

    def update_event(self, event: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError("Google Calendar integration requires OAuth setup")

    def delete_event(self, event_id: str) -> bool:
        raise NotImplementedError("Google Calendar integration requires OAuth setup")
