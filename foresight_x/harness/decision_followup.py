"""Decision follow-up eligibility, persistence, and due selection (quiet hours + caps)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from foresight_x.config import Settings, load_settings
from foresight_x.harness.outcome_tracker import load_decision_outcome_optional
from foresight_x.schemas import (
    DecisionFollowup,
    DecisionFollowupToastPayload,
    DecisionOutcome,
    DecisionTrace,
    FollowupEligibility,
    FollowupSchedule,
    TimePressure,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_decision_outcome_from_reflective(
    decision_id: str,
    chosen_option: str | None,
    outcome_status: str,
    outcome_text: str | None,
    satisfaction: int | None,
    *,
    lessons: list[str] | None = None,
    source: str = "followup_nudge",
) -> DecisionOutcome:
    """Map lightweight reflective statuses onto the persisted DecisionOutcome schema + memory hooks."""
    actual = (outcome_text or "").strip() or outcome_status.replace("_", " ")
    took = outcome_status in ("went_well", "mixed", "did_not_work")
    if outcome_status in ("still_pending", "changed_mind"):
        took = False
    rev = outcome_status == "changed_mind"
    q = satisfaction
    if q is None:
        q = {
            "went_well": 5,
            "mixed": 3,
            "did_not_work": 2,
            "still_pending": 3,
            "changed_mind": 3,
            "unknown": 3,
        }.get(outcome_status, 3)
    return DecisionOutcome(
        decision_id=decision_id,
        user_took_recommended_action=took,
        actual_outcome=actual,
        user_reported_quality=q,
        reversed_later=rev,
        timestamp=_utc_now_iso(),
        chosen_option_label=(chosen_option or "").strip(),
        reflective_outcome_status=outcome_status,
        reflective_outcome_text=(outcome_text or "").strip(),
        lessons=list(lessons or []),
        outcome_source=source,
        satisfaction=satisfaction,
    )


def _parse_iso(s: str | None) -> datetime | None:
    if not s or not str(s).strip():
        return None
    raw = str(s).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _resolve_tz(name: str) -> ZoneInfo:
    n = (name or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(n)
    except Exception:
        return ZoneInfo("UTC")


def _local_hour(now_utc: datetime, tz: ZoneInfo) -> int:
    return now_utc.astimezone(tz).hour


def _local_date_str(now_utc: datetime, tz: ZoneInfo) -> str:
    return now_utc.astimezone(tz).date().isoformat()


def _in_quiet_hours(now_utc: datetime, tz: ZoneInfo, start_h: int = 9, end_h: int = 21) -> bool:
    h = _local_hour(now_utc, tz)
    return h < start_h or h >= end_h


def _next_quiet_end_utc(now_utc: datetime, tz: ZoneInfo, start_h: int = 9) -> datetime:
    """Next local time when hour >= start_h (same day if before end_h block spanned midnight — we use simple day boundary)."""
    local = now_utc.astimezone(tz)
    if _local_hour(now_utc, tz) < start_h:
        next_local = local.replace(hour=start_h, minute=0, second=0, microsecond=0)
        if next_local <= local:
            next_local += timedelta(days=1)
    else:
        # after end_h (21): roll to tomorrow start_h
        next_local = (local + timedelta(days=1)).replace(hour=start_h, minute=0, second=0, microsecond=0)
    return next_local.astimezone(timezone.utc)


def _followups_file(user_id: str, settings: Settings) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", user_id or "unknown")
    root = settings.followups_dir
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{safe}.json"


def _notify_state_file(user_id: str, settings: Settings) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", user_id or "unknown")
    root = settings.followups_dir / ".notify"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{safe}.json"


def load_all_followups(user_id: str, *, settings: Settings | None = None) -> list[DecisionFollowup]:
    s = settings or load_settings()
    path = _followups_file(user_id, s)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get("followups") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[DecisionFollowup] = []
    for row in items:
        if isinstance(row, dict):
            try:
                out.append(DecisionFollowup.model_validate(row))
            except Exception:
                continue
    return out


def save_all_followups(user_id: str, followups: list[DecisionFollowup], *, settings: Settings | None = None) -> None:
    s = settings or load_settings()
    path = _followups_file(user_id, s)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"followups": [f.model_dump(mode="json") for f in followups]}, indent=2), encoding="utf-8")


def _load_notify_state(user_id: str, settings: Settings) -> dict:
    path = _notify_state_file(user_id, settings)
    if not path.is_file():
        return {"displays": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"displays": []}
    except (OSError, json.JSONDecodeError):
        return {"displays": []}


def _save_notify_state(user_id: str, state: dict, settings: Settings) -> None:
    path = _notify_state_file(user_id, settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _prune_displays(displays: list, *, keep_days: int = 3) -> list:
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    out: list = []
    for row in displays:
        if not isinstance(row, dict):
            continue
        at = _parse_iso(str(row.get("at") or ""))
        if at and at >= cutoff:
            out.append(row)
    return out


def count_displays_today(user_id: str, tz_name: str, *, settings: Settings | None = None) -> int:
    s = settings or load_settings()
    st = _load_notify_state(user_id, s)
    displays = _prune_displays(list(st.get("displays") or []))
    tz = _resolve_tz(tz_name)
    today = _local_date_str(datetime.now(timezone.utc), tz)
    n = 0
    for row in displays:
        if str(row.get("local_date") or "") == today:
            n += 1
    return n


def record_followup_displayed(user_id: str, followup_id: str, tz_name: str, *, settings: Settings | None = None) -> None:
    s = settings or load_settings()
    st = _load_notify_state(user_id, s)
    displays = _prune_displays(list(st.get("displays") or []))
    tz = _resolve_tz(tz_name)
    now = datetime.now(timezone.utc)
    displays.append(
        {
            "followup_id": followup_id,
            "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "local_date": _local_date_str(now, tz),
        }
    )
    st["displays"] = displays
    _save_notify_state(user_id, st, s)


_TRIVIAL_FOOD = re.compile(
    r"\b(pizza|burger|taco|sushi|coffee|lunch|dinner|breakfast|snack|what to eat|where to eat)\b", re.I
)
_TOY = re.compile(
    r"\b(test decision|ignore this|dummy|asdf|lorem ipsum|toy prompt)\b|^\s*test\s*$",
    re.I,
)
_UNSAFE = re.compile(r"\b(kill|suicide|bomb|terror)\b", re.I)


def should_create_followup(trace: DecisionTrace) -> FollowupEligibility:
    """Heuristic eligibility — avoids spam on trivial one-off prompts."""
    raw = (trace.original_user_input or trace.user_state.raw_input or "").strip()
    low = raw.lower()
    if _UNSAFE.search(low):
        return FollowupEligibility(
            should_create=False,
            priority="low",
            decision_type="unknown",
            reason="unsafe_or_blocked_prompt",
            schedule_offsets_days=[],
        )
    if _TOY.search(low) or len(raw) < 8:
        return FollowupEligibility(
            should_create=False,
            priority="low",
            decision_type="unknown",
            reason="toy_or_too_short",
            schedule_offsets_days=[],
        )

    us = trace.user_state
    dt_raw = str(us.decision_type or "unknown").lower()
    mapped: str = "unknown"
    if any(k in dt_raw for k in ("career", "job", "work")):
        mapped = "career"
    elif any(k in dt_raw for k in ("school", "study", "academic", "class", "degree")):
        mapped = "academic"
    elif any(k in dt_raw for k in ("relationship", "partner", "family", "friend")):
        mapped = "relationship"
    elif any(k in dt_raw for k in ("plan", "planning", "project", "move", "relocate")):
        mapped = "planning"

    time_sensitive = us.time_pressure == TimePressure.HIGH or bool((us.deadline_hint or "").strip())

    has_action = False
    has_deadline = False
    if trace.report_surface and trace.report_surface.primary_next_action:
        pa = trace.report_surface.primary_next_action
        has_action = bool((pa.text or "").strip())
        has_deadline = bool((pa.deadline or "").strip())

    has_rec = bool(
        trace.recommendation
        and (trace.recommendation.chosen_option_id or (trace.recommendation.reasoning or "").strip())
    )

    trivial_food = bool(_TRIVIAL_FOOD.search(low)) and not time_sensitive and mapped == "unknown"

    if trivial_food and not has_action and not has_deadline:
        return FollowupEligibility(
            should_create=False,
            priority="low",
            decision_type="low_stakes",
            reason="trivial_food_or_casual",
            schedule_offsets_days=[],
        )

    should = (
        mapped in ("career", "academic", "relationship", "planning")
        or time_sensitive
        or has_action
        or has_deadline
        or has_rec
    )

    if not should:
        return FollowupEligibility(
            should_create=False,
            priority="low",
            decision_type="low_stakes",
            reason="low_signal_decision",
            schedule_offsets_days=[],
        )

    priority: str = "medium"
    offsets: list[int]
    if time_sensitive or (mapped == "planning" and has_deadline):
        priority = "high"
        offsets = [1, 3, 7]
    elif mapped in ("career", "academic"):
        priority = "high" if mapped == "career" else "medium"
        offsets = [3, 7, 14]
    elif mapped == "relationship":
        offsets = [7, 14, 30]
    elif mapped == "planning":
        offsets = [7, 14, 30]
    else:
        # recommendation-only / unknown type with signal
        mapped = mapped if mapped != "unknown" else "unknown"
        if time_sensitive:
            offsets = [1, 3, 7]
        else:
            offsets = [7, 14]

    dtype: str = "time_sensitive" if time_sensitive else mapped
    if dtype == "unknown" and has_deadline:
        dtype = "time_sensitive"

    return FollowupEligibility(
        should_create=True,
        priority=priority,  # type: ignore[arg-type]
        decision_type=dtype,
        reason="meaningful_decision_signal",
        schedule_offsets_days=offsets,
    )


def _next_due_iso_from_offsets(created_at: str, offsets: list[int], completed: list[int]) -> str | None:
    """First offset not in completed; due = created + offset days at 12:00 UTC."""
    base = _parse_iso(created_at) or datetime.now(timezone.utc)
    for off in offsets:
        if off in completed:
            continue
        due = base + timedelta(days=int(off))
        due = due.replace(hour=12, minute=0, second=0, microsecond=0)
        return due.strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def create_decision_followup_if_needed(
    user_id: str,
    decision_id: str,
    decision_report: DecisionTrace,
    *,
    thread_id: str | None = None,
    settings: Settings | None = None,
) -> DecisionFollowup | None:
    s = settings or load_settings()
    existing = load_all_followups(user_id, settings=s)
    for f in existing:
        if f.decision_id == decision_id and f.status not in ("completed", "cancelled") and not f.outcome_recorded:
            return None

    elig = should_create_followup(decision_report)
    if not elig.should_create or not elig.schedule_offsets_days:
        return None

    if load_decision_outcome_optional(decision_id, settings=s) is not None:
        return None

    title = (decision_report.original_user_input or decision_report.user_state.raw_input or "").strip()
    title = title[:120] + ("…" if len(title) > 120 else "")
    prompt = (decision_report.user_state.raw_input or decision_report.original_user_input or "").strip()[:500]

    now_iso = _utc_now_iso()
    sched = FollowupSchedule(offsets_days=list(elig.schedule_offsets_days), completed_offsets_days=[])
    next_due = _next_due_iso_from_offsets(now_iso, sched.offsets_days, sched.completed_offsets_days)

    allowed_dt = (
        "time_sensitive",
        "career",
        "relationship",
        "academic",
        "planning",
        "low_stakes",
        "unknown",
    )
    dt_fix = elig.decision_type if elig.decision_type in allowed_dt else "unknown"
    fu = DecisionFollowup(
        id=str(uuid.uuid4()),
        user_id=user_id,
        decision_id=decision_id,
        thread_id=(thread_id or "").strip(),
        decision_title=title,
        decision_prompt=prompt,
        decision_type=dt_fix,  # type: ignore[arg-type]
        priority=elig.priority,  # type: ignore[assignment]
        status="scheduled",
        created_at=now_iso,
        next_due_at=next_due,
        schedule=sched,
        dismissed_count=0,
        outcome_recorded=False,
        metadata={"eligibility_reason": elig.reason},
    )

    existing.append(fu)
    save_all_followups(user_id, existing, settings=s)
    return fu


def delete_followups_for_decision(user_id: str, decision_id: str, *, settings: Settings | None = None) -> int:
    s = settings or load_settings()
    items = load_all_followups(user_id, settings=s)
    n_before = len(items)
    items = [f for f in items if f.decision_id != decision_id]
    if len(items) != n_before:
        save_all_followups(user_id, items, settings=s)
    return n_before - len(items)


def _relative_phrase(trace_ts: str, now: datetime, tz: ZoneInfo) -> str:
    t0 = _parse_iso(trace_ts)
    if not t0:
        return "Earlier"
    days = (now.astimezone(tz).date() - t0.astimezone(tz).date()).days
    if days <= 0:
        return "Recently"
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} days ago"
    if days < 14:
        return "Last week"
    if days < 60:
        return "A few weeks ago"
    return "A while ago"


def _toast_copy(slime_name: str, trace_ts: str, prompt_preview: str, now: datetime, tz: ZoneInfo) -> tuple[str, str]:
    name = (slime_name or "Buddy").strip() or "Buddy"
    rel = _relative_phrase(trace_ts, now, tz)
    title = f"{name} check-in"
    body = (
        f"{rel}, you were weighing this decision. Want to record what happened?"
        if prompt_preview
        else f"{rel}, you were working through a decision. Want to close the loop?"
    )
    return title, body


def build_toast_payload(
    fu: DecisionFollowup,
    *,
    trace_timestamp: str,
    slime_name: str = "Mochi",
    tz_name: str = "UTC",
) -> DecisionFollowupToastPayload:
    tz = _resolve_tz(tz_name)
    now = datetime.now(timezone.utc)
    title, body = _toast_copy(slime_name, trace_timestamp, fu.decision_prompt[:160], now, tz)
    rel = _relative_phrase(trace_timestamp, now, tz)
    return DecisionFollowupToastPayload(
        id=fu.id,
        decision_id=fu.decision_id,
        thread_id=fu.thread_id,
        decision_title=fu.decision_title,
        decision_prompt=fu.decision_prompt[:280],
        decision_type=fu.decision_type,
        title=title,
        body=body,
        relative_phrase=rel,
        created_at_trace=trace_timestamp,
    )


def _is_due_row(fu: DecisionFollowup, now: datetime) -> bool:
    if fu.outcome_recorded or fu.status in ("completed", "cancelled"):
        return False
    if fu.status == "dismissed" and fu.dismissed_count >= 2:
        return False
    if fu.status == "snoozed":
        until = _parse_iso(fu.snoozed_until)
        if until and until > now:
            return False
        return True
    if fu.status == "scheduled":
        due = _parse_iso(fu.next_due_at)
        return bool(due and due <= now)
    if fu.status == "due":
        return True
    return False


def _hours_since_shown(fu: DecisionFollowup, now: datetime) -> float | None:
    last = _parse_iso(fu.last_shown_at)
    if not last:
        return None
    return (now - last).total_seconds() / 3600.0


def get_due_followups(
    user_id: str,
    now: datetime | None = None,
    *,
    tz_name: str = "UTC",
    max_per_fetch: int = 8,
    settings: Settings | None = None,
) -> list[DecisionFollowup]:
    """Return follow-ups that are due by time; does not apply daily display caps (see filter_for_toast_delivery)."""
    s = settings or load_settings()
    n = now or datetime.now(timezone.utc)
    tz = _resolve_tz(tz_name)
    if _in_quiet_hours(n, tz):
        return []

    items = [f for f in load_all_followups(user_id, settings=s) if _is_due_row(f, n)]
    items.sort(
        key=lambda f: (
            0 if f.priority == "high" else 1 if f.priority == "medium" else 2,
            _parse_iso(f.next_due_at) or datetime.min.replace(tzinfo=timezone.utc),
        )
    )
    return items[:max_per_fetch]


def filter_for_toast_delivery(
    user_id: str,
    candidates: list[DecisionFollowup],
    *,
    tz_name: str = "UTC",
    max_per_day: int = 2,
    max_return: int = 8,
    settings: Settings | None = None,
) -> list[DecisionFollowup]:
    """Apply daily display cap and 24h reshow guard."""
    s = settings or load_settings()
    if count_displays_today(user_id, tz_name, settings=s) >= max_per_day:
        return []

    now = datetime.now(timezone.utc)
    out: list[DecisionFollowup] = []
    for fu in candidates:
        hs = _hours_since_shown(fu, now)
        if hs is not None and hs < 24.0:
            continue
        out.append(fu)
        if len(out) >= max_return:
            break
    return out


def history_followup_augment(
    user_id: str,
    decision_id: str,
    *,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Extra fields for GET /api/traces rows (follow-up state + reflective outcome label)."""
    s = settings or load_settings()
    fus = [f for f in load_all_followups(user_id, settings=s) if f.decision_id == decision_id]
    out: dict[str, Any] = {"followup_status": "", "followup_next_checkin": None, "followup_outcome_label": ""}
    o = load_decision_outcome_optional(decision_id, settings=s)
    if o and (o.reflective_outcome_status or "").strip():
        out["followup_outcome_label"] = str(o.reflective_outcome_status).replace("_", " ")
    elif o and (o.actual_outcome or "").strip():
        out["followup_outcome_label"] = "outcome recorded"
    if not fus:
        return out
    fu = sorted(fus, key=lambda f: f.created_at, reverse=True)[0]
    if fu.status == "dismissed" and fu.dismissed_count >= 2:
        out["followup_status"] = "dismissed"
    elif fu.status == "completed" or fu.outcome_recorded:
        out["followup_status"] = "completed"
    elif fu.status in ("snoozed", "scheduled", "due"):
        out["followup_status"] = fu.status
        out["followup_next_checkin"] = fu.snoozed_until or fu.next_due_at
    else:
        out["followup_status"] = fu.status
    return out


def mark_followups_completed_for_decision(user_id: str, decision_id: str, *, settings: Settings | None = None) -> None:
    s = settings or load_settings()
    items = load_all_followups(user_id, settings=s)
    changed = False
    for i, f in enumerate(items):
        if f.decision_id == decision_id:
            items[i] = f.model_copy(
                update={"status": "completed", "outcome_recorded": True, "next_due_at": None, "snoozed_until": None}
            )
            changed = True
    if changed:
        save_all_followups(user_id, items, settings=s)


def get_followups_for_decision(user_id: str, decision_id: str, *, settings: Settings | None = None) -> list[DecisionFollowup]:
    return [f for f in load_all_followups(user_id, settings=settings or load_settings()) if f.decision_id == decision_id]


def _find_followup(user_id: str, followup_id: str, settings: Settings) -> tuple[list[DecisionFollowup], int] | None:
    items = load_all_followups(user_id, settings=settings)
    for i, f in enumerate(items):
        if f.id == followup_id:
            return items, i
    return None


def dismiss_followup(
    user_id: str,
    followup_id: str,
    *,
    reason: str = "dismissed",
    settings: Settings | None = None,
) -> DecisionFollowup | None:
    s = settings or load_settings()
    found = _find_followup(user_id, followup_id, s)
    if not found:
        return None
    items, idx = found
    fu = items[idx]
    new_count = fu.dismissed_count + 1
    if new_count >= 2:
        items[idx] = fu.model_copy(update={"dismissed_count": new_count, "status": "dismissed", "next_due_at": None})
    else:
        bump = datetime.now(timezone.utc) + timedelta(days=3)
        next_due = bump.strftime("%Y-%m-%dT%H:%M:%SZ")
        items[idx] = fu.model_copy(
            update={
                "dismissed_count": new_count,
                "status": "scheduled",
                "next_due_at": next_due,
                "metadata": {**fu.metadata, "last_dismiss_reason": reason},
            }
        )
    save_all_followups(user_id, items, settings=s)
    return items[idx]


def snooze_followup(
    user_id: str,
    followup_id: str,
    *,
    until_iso: str | None,
    preset: str | None = None,
    settings: Settings | None = None,
) -> DecisionFollowup | None:
    s = settings or load_settings()
    found = _find_followup(user_id, followup_id, s)
    if not found:
        return None
    items, idx = found
    fu = items[idx]
    now = datetime.now(timezone.utc)
    if until_iso and str(until_iso).strip():
        until = _parse_iso(str(until_iso).strip())
    else:
        p = (preset or "tomorrow").strip().lower()
        if p == "3_days":
            until = now + timedelta(days=3)
        elif p == "next_week":
            until = now + timedelta(days=7)
        else:
            until = now + timedelta(days=1)
        until = until.replace(hour=12, minute=0, second=0, microsecond=0)
    if not until:
        until = now + timedelta(days=1)
    ustr = until.strftime("%Y-%m-%dT%H:%M:%SZ")
    items[idx] = fu.model_copy(update={"status": "snoozed", "snoozed_until": ustr, "next_due_at": ustr})
    save_all_followups(user_id, items, settings=s)
    return items[idx]


def still_pending_followup(user_id: str, followup_id: str, *, settings: Settings | None = None) -> DecisionFollowup | None:
    s = settings or load_settings()
    found = _find_followup(user_id, followup_id, s)
    if not found:
        return None
    items, idx = found
    fu = items[idx]
    sched = fu.schedule
    completed = list(sched.completed_offsets_days)
    now = datetime.now(timezone.utc)
    due = _parse_iso(fu.next_due_at) or now
    for off in sched.offsets_days:
        cand = (_parse_iso(fu.created_at) or now) + timedelta(days=off)
        if cand <= due + timedelta(seconds=1) and off not in completed:
            completed.append(off)
            break
    next_due = _next_due_iso_from_offsets(fu.created_at, sched.offsets_days, completed)
    if not next_due:
        next_due = (now + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    items[idx] = fu.model_copy(
        update={
            "status": "snoozed",
            "schedule": FollowupSchedule(offsets_days=sched.offsets_days, completed_offsets_days=completed),
            "snoozed_until": next_due,
            "next_due_at": next_due,
        }
    )
    save_all_followups(user_id, items, settings=s)
    return items[idx]


def mark_followup_shown(user_id: str, followup_id: str, *, settings: Settings | None = None) -> DecisionFollowup | None:
    s = settings or load_settings()
    found = _find_followup(user_id, followup_id, s)
    if not found:
        return None
    items, idx = found
    fu = items[idx]
    items[idx] = fu.model_copy(update={"last_shown_at": _utc_now_iso(), "status": "due" if fu.status == "scheduled" else fu.status})
    save_all_followups(user_id, items, settings=s)
    return items[idx]


def apply_followup_outcome(
    user_id: str,
    followup_id: str,
    *,
    outcome_status: str,
    save_lesson_to_memory: bool,
    settings: Settings | None = None,
) -> DecisionFollowup | None:
    """Mark follow-up completed; persistence of DecisionOutcome is handled by API layer."""
    s = settings or load_settings()
    found = _find_followup(user_id, followup_id, s)
    if not found:
        return None
    items, idx = found
    fu = items[idx]
    items[idx] = fu.model_copy(
        update={
            "status": "completed",
            "outcome_recorded": True,
            "next_due_at": None,
            "snoozed_until": None,
            "metadata": {
                **fu.metadata,
                "last_outcome_status": outcome_status,
                "save_lesson_requested": save_lesson_to_memory,
            },
        }
    )
    save_all_followups(user_id, items, settings=s)
    return items[idx]


def prune_followup_notify_displays(*, settings: Settings | None = None, keep_days: int = 14) -> int:
    """Prune stale rows in per-user notify JSON files under ``followups/.notify``. Returns files updated."""
    s = settings or load_settings()
    root = s.followups_dir / ".notify"
    if not root.is_dir():
        return 0
    touched = 0
    for path in root.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        displays = data.get("displays") if isinstance(data, dict) else None
        if not isinstance(displays, list):
            continue
        pruned = _prune_displays(displays, keep_days=keep_days)
        if len(pruned) == len(displays):
            continue
        data["displays"] = pruned
        try:
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            touched += 1
        except OSError:
            continue
    return touched


def run_followup_maintenance_for_data_dir(settings: Settings) -> dict[str, int]:
    """Disk hygiene for follow-up notification bookkeeping (complements client polling; no push)."""
    n = prune_followup_notify_displays(settings=settings, keep_days=14)
    return {"followup_notify_files_updated": n}
