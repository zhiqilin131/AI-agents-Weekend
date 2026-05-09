"""ICS helpers — import/export aligned with RFC 5545 via icalendar when available."""

from __future__ import annotations

from typing import Any


def events_to_ics(events: list[dict[str, Any]], *, calendar_name: str = "Foresight-X Execution") -> str:
    """Serialize minimal VCALENDAR with VEVENTs. Fallback is simple lines if icalendar missing."""
    try:
        from icalendar import Calendar, Event  # type: ignore
        from datetime import datetime

        cal = Calendar()
        cal.add("prodid", "-//Foresight-X//Execution Calendar//EN")
        cal.add("version", "2.0")
        cal.add("x-wr-calname", calendar_name)
        for raw in events:
            ev = Event()
            ev.add("summary", str(raw.get("title") or "Event"))
            ev.add("uid", str(raw.get("id") or "evt"))
            for key, ical_key in (("start", "dtstart"), ("end", "dtend")):
                iso = raw.get("start" if key == "start" else "end")
                if not iso:
                    continue
                try:
                    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
                    ev.add(ical_key, dt)
                except ValueError:
                    continue
            if raw.get("description"):
                ev.add("description", str(raw["description"])[:5000])
            cal.add_component(ev)
        return cal.to_ical().decode("utf-8")
    except Exception:
        lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"X-WR-CALNAME:{calendar_name}"]
        for raw in events:
            lines.append("BEGIN:VEVENT")
            lines.append(f"UID:{raw.get('id', 'evt')}")
            lines.append(f"SUMMARY:{raw.get('title', 'Event')}")
            lines.append("END:VEVENT")
        lines.append("END:VCALENDAR")
        return "\r\n".join(lines)
