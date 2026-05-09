"""Detect scheduling conflicts between proposed and existing events."""

from __future__ import annotations

from datetime import datetime

from foresight_x.calendar_agent.schemas import CalendarEvent, CalendarPreferences, Conflict, Severity


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _overlap(a_s: datetime, a_e: datetime, b_s: datetime, b_e: datetime) -> bool:
    return a_s < b_e and a_e > b_s


def _hour_from_working(pref: CalendarPreferences, key: str, default: int) -> int:
    raw = (pref.working_hours or {}).get(key) or ""
    try:
        part = str(raw).split(":")[0]
        return int(part)
    except (ValueError, IndexError):
        return default


def detect_conflicts(
    proposed: list[CalendarEvent],
    existing: list[CalendarEvent],
    *,
    preferences: CalendarPreferences | None = None,
) -> list[Conflict]:
    out: list[Conflict] = []
    pref = preferences or CalendarPreferences()
    day_start_h = _hour_from_working(pref, "start", 9)
    day_end_h = _hour_from_working(pref, "end", 22)

    locked_existing = [e for e in existing if e.locked or e.source == "uploaded"]

    for pe in proposed:
        try:
            ps, pe_ = _parse_iso(pe.start), _parse_iso(pe.end)
        except ValueError:
            out.append(
                Conflict(
                    type="outside_working_hours",
                    message=f"Invalid start/end for proposed event: {pe.title}",
                    affected_event_ids=[pe.id],
                    severity="high",
                )
            )
            continue

        if ps.hour < day_start_h or pe_.hour > day_end_h or (pe_.hour == day_end_h and pe_.minute > 0):
            out.append(
                Conflict(
                    type="outside_working_hours",
                    message=f"“{pe.title}” extends outside typical working hours ({day_start_h}:00–{day_end_h}:00).",
                    affected_event_ids=[pe.id],
                    severity="low",
                )
            )

        for ex in locked_existing:
            try:
                xs, xe = _parse_iso(ex.start), _parse_iso(ex.end)
            except ValueError:
                continue
            if _overlap(ps, pe_, xs, xe):
                out.append(
                    Conflict(
                        type="overlap",
                        message=f"Overlaps locked/busy block: {ex.title}",
                        affected_event_ids=[pe.id, ex.id],
                        severity="high",
                    )
                )

        for other in proposed:
            if other.id == pe.id:
                continue
            try:
                os_, oe = _parse_iso(other.start), _parse_iso(other.end)
            except ValueError:
                continue
            if _overlap(ps, pe_, os_, oe):
                out.append(
                    Conflict(
                        type="overlap",
                        message=f"Proposed events overlap: {pe.title} vs {other.title}",
                        affected_event_ids=[pe.id, other.id],
                        severity="medium",
                    )
                )

    return out


def mark_event_conflicts(proposed: list[CalendarEvent], conflicts: list[Conflict]) -> list[CalendarEvent]:
    bad_ids: set[str] = set()
    for c in conflicts:
        if c.type == "overlap":
            for eid in c.affected_event_ids:
                bad_ids.add(eid)
    out: list[CalendarEvent] = []
    for e in proposed:
        cp = e.model_copy(update={"conflict": e.id in bad_ids})
        out.append(cp)
    return out


def severity_max(conflicts: list[Conflict]) -> Severity:
    order = {"low": 0, "medium": 1, "high": 2}
    best: Severity = "low"
    for c in conflicts:
        if order.get(c.severity, 0) > order.get(best, 0):
            best = c.severity
    return best
