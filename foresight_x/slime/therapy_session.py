"""Therapy session lifecycle for Rimumu (wellbeing) threads — intake, active session, report."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from foresight_x.slime.wellbeing_router import WellbeingRouteResult

TherapyStatus = Literal["not_started", "active", "ended"]


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty_session() -> dict[str, Any]:
    return {
        "status": "not_started",
        "intake_complete": False,
        "check_in_count": 0,
        "episode_notes": [],
    }


def get_therapy_session(thread: dict[str, Any] | None) -> dict[str, Any]:
    if not thread:
        return _empty_session()
    raw = thread.get("therapy_session")
    if isinstance(raw, dict) and raw:
        return dict(raw)
    # Legacy wellbeing_session → therapy_session shape
    legacy = thread.get("wellbeing_session")
    if isinstance(legacy, dict) and legacy:
        merged = {**_empty_session(), **legacy}
        if legacy.get("intake_complete") and merged.get("status") == "not_started":
            merged["status"] = "not_started"
        return merged
    return _empty_session()


def _sync_thread_sessions(thread: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    thread["therapy_session"] = session
    # Backward compat for readers of wellbeing_session
    thread["wellbeing_session"] = {
        k: session[k]
        for k in (
            "intake_complete",
            "intake_at",
            "mood_score",
            "primary_concern",
            "session_goal",
            "optional_note",
            "check_in_count",
            "focus_theme",
            "episode_notes",
            "last_protocol",
            "last_turn_at",
            "last_assistant_focus",
            "sessions_protocols_used",
        )
        if k in session
    }
    return session


def therapy_status(thread: dict[str, Any] | None) -> TherapyStatus:
    st = str(get_therapy_session(thread).get("status") or "not_started")
    if st in ("not_started", "active", "ended"):
        return st  # type: ignore[return-value]
    return "not_started"


def intake_complete(thread: dict[str, Any] | None) -> bool:
    return bool(get_therapy_session(thread).get("intake_complete"))


def save_wellbeing_intake(
    thread: dict[str, Any],
    *,
    mood_score: int,
    primary_concern: str,
    session_goal: str,
    optional_note: str = "",
    support_preference: str = "mixed",
) -> dict[str, Any]:
    """Persist structured check-in (not diagnostic)."""
    prev = get_therapy_session(thread)
    count = int(prev.get("check_in_count") or 0) + 1
    pref = (support_preference or "mixed").strip().lower()
    if pref not in ("listen", "structured", "mixed"):
        pref = "mixed"
    session = {
        **prev,
        "status": prev.get("status") or "not_started",
        "intake_complete": True,
        "intake_at": _utc_now(),
        "mood_score": max(0, min(10, int(mood_score))),
        "primary_concern": (primary_concern or "").strip()[:500],
        "session_goal": (session_goal or "").strip()[:500],
        "optional_note": (optional_note or "").strip()[:500],
        "support_preference": pref,
        "check_in_count": count,
        "focus_theme": (primary_concern or session_goal or "").strip()[:200],
    }
    return _sync_thread_sessions(thread, session)


def start_therapy(thread: dict[str, Any]) -> dict[str, Any]:
    session = get_therapy_session(thread)
    if session.get("status") == "ended":
        raise ValueError("therapy_already_ended")
    if not session.get("intake_complete"):
        raise ValueError("intake_required")
    session = {
        **session,
        "status": "active",
        "started_at": session.get("started_at") or _utc_now(),
    }
    return _sync_thread_sessions(thread, session)


def end_therapy(thread: dict[str, Any], *, report: dict[str, Any]) -> dict[str, Any]:
    session = get_therapy_session(thread)
    if session.get("status") != "active":
        raise ValueError("therapy_not_active")
    session = {
        **session,
        "status": "ended",
        "ended_at": _utc_now(),
        "report": report,
    }
    return _sync_thread_sessions(thread, session)


def thread_has_therapy_report_artifact(thread: dict[str, Any] | None) -> bool:
    if not thread:
        return False
    for m in thread.get("messages") or []:
        if not isinstance(m, dict):
            continue
        meta = m.get("metadata")
        if isinstance(meta, dict) and str(meta.get("type") or "") == "therapy_report_artifact":
            return True
    return False


def attach_therapy_report_artifact(thread: dict[str, Any], report: dict[str, Any]) -> None:
    """Append assistant artifact message for therapy report."""
    if thread_has_therapy_report_artifact(thread):
        return
    messages = list(thread.get("messages") or [])
    rid = str(report.get("id") or uuid.uuid4())
    summary = str(report.get("executive_summary") or "").strip()
    messages.append(
        {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": summary or "Your session summary is ready.",
            "created_at": _utc_now(),
            "metadata": {
                "type": "therapy_report_artifact",
                "therapy_report_id": rid,
                "title": "Therapy Report",
                "summary": summary,
                "status": "complete",
                "created_at": str(report.get("generated_at") or _utc_now()),
                "therapy_report": report,
            },
        }
    )
    thread["messages"] = messages


def ensure_therapy_report_artifact(thread: dict[str, Any]) -> bool:
    """Backfill chat artifact when session has a report but transcript does not."""
    session = get_therapy_session(thread)
    report = session.get("report")
    if not isinstance(report, dict) or not str(report.get("executive_summary") or "").strip():
        return False
    if thread_has_therapy_report_artifact(thread):
        return False
    attach_therapy_report_artifact(thread, report)
    return True


def record_wellbeing_turn(
    thread: dict[str, Any],
    *,
    user_message: str,
    route: WellbeingRouteResult | None,
    assistant_preview: str = "",
) -> None:
    """Light episodic memory on thread for course continuity."""
    session = get_therapy_session(thread)
    if not session.get("intake_complete"):
        return
    history = list(session.get("episode_notes") or [])
    snippet = (user_message or "").strip()[:160]
    if snippet:
        history.append({"at": _utc_now(), "user": snippet})
    history = history[-8:]
    session = {
        **session,
        "last_protocol": route.protocol if route else session.get("last_protocol"),
        "last_turn_at": _utc_now(),
        "episode_notes": history,
    }
    if route and not route.safety_escalation:
        session["sessions_protocols_used"] = list(
            dict.fromkeys([*(session.get("sessions_protocols_used") or []), route.protocol])
        )[-12:]
    preview = (assistant_preview or "").strip()[:120]
    if preview:
        session["last_assistant_focus"] = preview
    _sync_thread_sessions(thread, session)

    if route and route.assessment:
        from foresight_x.slime.wellbeing_clinical import (
            WellbeingTurnAssessment,
            apply_clinical_assessment_to_session,
        )

        try:
            assessment = WellbeingTurnAssessment.model_validate(route.assessment)
            apply_clinical_assessment_to_session(
                thread, assessment, assistant_preview=assistant_preview
            )
        except Exception:
            pass


def build_wellbeing_session_prompt_block(thread: dict[str, Any] | None) -> str:
    """Injected into wellbeing turns — continuity + professional course frame."""
    session = get_therapy_session(thread)
    if not session:
        return (
            "--- Wellbeing course frame ---\n"
            "This is an ongoing support series (not one-off tips). If intake is missing, "
            "gently offer a brief check-in (mood 0–10, main concern, one goal) before depth.\n"
        )

    lines = [
        "--- Wellbeing course session (continuity) ---",
        "Treat this as an ongoing support series with the same human — reference prior turns in THIS thread.",
        "Be professional and warm: structured, evidence-informed, never diagnostic.",
        "Alliance-first: not every turn needs a technique. One protocol step when intervention fits.",
        "Do NOT repeat the same body skill (breathing, 5-4-3-2-1) unless user asks or panic-level distress.",
        "Reflect the user in second person (you/your) — never parrot or echo their message verbatim.",
    ]
    st = str(session.get("status") or "not_started")
    if st == "active":
        lines.append("Therapy session is ACTIVE — stay focused on today's goal; do not reopen intake unless asked.")
    elif st == "ended":
        lines.append("Therapy session has ENDED — if user continues, acknowledge closure gently and offer a new session.")

    if session.get("intake_complete"):
        mood = session.get("mood_score")
        if mood is not None:
            lines.append(f"Latest mood (0–10, self-report): {mood}")
        concern = (session.get("primary_concern") or "").strip()
        goal = (session.get("session_goal") or "").strip()
        if concern:
            lines.append(f"Primary concern for this course: {concern[:280]}")
        if goal:
            lines.append(f"Session goal they named: {goal[:280]}")
        pref = (session.get("support_preference") or "").strip()
        if pref:
            pref_guide = {
                "listen": "User prefers listening — reflect and ask; minimize techniques unless they ask.",
                "structured": "User prefers structured skills — offer one clear step per turn with consent.",
                "mixed": "Balanced: start with accurate reflection; offer ONE skill when process + intensity fit; "
                "after two technique turns, return to pure listening.",
            }
            lines.append(f"Support preference: {pref} — {pref_guide.get(pref, pref_guide['mixed'])}")
        form = (session.get("formulation_snapshot") or "").strip()
        if form:
            lines.append(f"Working formulation (internal): {form[:320]}")
        skills = session.get("skills_used") or []
        if skills:
            lines.append(f"Skills already used this thread: {', '.join(str(x) for x in skills[-6:])}")
        phase = (session.get("session_phase") or "").strip()
        if phase:
            lines.append(f"Session phase: {phase}")
        focus = (session.get("focus_theme") or "").strip()
        if focus:
            lines.append(f"Keep thematic focus: {focus[:200]}")
        last_p = (session.get("last_protocol") or "").strip()
        if last_p and last_p != "safety_escalation":
            lines.append(f"Previous protocol step: {last_p} — build on it or transition deliberately.")
        notes = session.get("episode_notes") or []
        if notes:
            recent = [n.get("user", "") for n in notes[-3:] if isinstance(n, dict)]
            recent = [x for x in recent if x]
            if recent:
                lines.append("Recent thread themes: " + " | ".join(recent)[:320])
        check_n = int(session.get("check_in_count") or 1)
        lines.append(f"Check-in number in this thread: {check_n}")
    else:
        lines.append("Intake not completed — offer a brief structured check-in before protocol depth.")

    lines.append(
        "Close loops: name what changed since last message, one concrete skill or reflection, one next step."
    )
    return "\n".join(lines) + "\n"


def therapy_list_summary(thread: dict[str, Any]) -> dict[str, Any]:
    """Compact fields for thread list UI."""
    session = get_therapy_session(thread)
    report = session.get("report") if isinstance(session.get("report"), dict) else None
    return {
        "therapy_status": session.get("status") or "not_started",
        "intake_complete": bool(session.get("intake_complete")),
        "mood_score": session.get("mood_score"),
        "primary_concern": (session.get("primary_concern") or "")[:120],
        "has_therapy_report": bool(report),
        "therapy_report_id": (report or {}).get("id") if report else None,
    }
