"""Thread-level pending user actions (clarification, decision offer, role mode)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from foresight_x.chat.conversation_service import _build_shadow_suggestion
from foresight_x.chat.decision_trigger import _ensure_state

PendingActionType = Literal["clarification", "decision_report", "role_mode"]
PendingBlock = Literal["send_message", "generate_decision_report"]

_PRIORITY: dict[PendingActionType, int] = {
    "clarification": 0,
    "decision_report": 1,
    "role_mode": 2,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_id() -> str:
    return f"pa-{uuid.uuid4().hex[:12]}"


def clear_pending_action(thread: dict[str, Any], *, resolution: str = "") -> None:
    thread.pop("pending_action", None)
    st = thread.get("clarification_state")
    if isinstance(st, dict):
        st.pop("pending_questions", None)
        st.pop("pending_meta", None)
        st.pop("pending_note", None)
        st.pop("pending_blocks", None)
    if resolution:
        dts = _ensure_state(thread)
        if resolution in {"answered", "skipped", "dismissed", "confirmed", "expired"}:
            dts["pending_confirmation"] = False


def _pack(
    *,
    action_type: PendingActionType,
    title: str,
    message: str,
    payload: dict[str, Any],
    blocks: list[str],
) -> dict[str, Any]:
    return {
        "id": _new_id(),
        "type": action_type,
        "title": title,
        "message": message,
        "blocks": blocks,
        "payload": payload,
        "created_at": _now_iso(),
        "why": str(payload.get("why") or payload.get("why_this_question") or "").strip(),
    }


def set_clarification_pending(
    thread: dict[str, Any],
    *,
    questions: list[dict[str, Any]],
    meta: dict[str, Any] | None = None,
    note: str = "",
    blocks: list[str] | None = None,
    pending_kind: str | None = None,
    pending_text: str | None = None,
) -> dict[str, Any]:
    blk = blocks or ["send_message", "generate_decision_report"]
    payload: dict[str, Any] = {
        "questions": questions,
        "meta": meta or {},
        "note": note,
        "why": (meta or {}).get("why_this_question") or "",
        "pending_kind": pending_kind,
        "pending_text": pending_text,
    }
    pa = _pack(
        action_type="clarification",
        title="One thing to clarify",
        message="Answer or skip so the next reply matches what you care about.",
        payload=payload,
        blocks=blk,
    )
    thread["pending_action"] = pa
    st = thread.setdefault("clarification_state", {})
    if isinstance(st, dict):
        st["pending_questions"] = questions
        st["pending_meta"] = meta or {}
        st["pending_note"] = note
        st["pending_blocks"] = blk
    return pa


def set_manual_decision_pending(
    thread: dict[str, Any],
    *,
    original_prompt: str,
    enhanced_prompt: str,
) -> dict[str, Any]:
    """Pending card after manual Decision Mode enhance — user confirms with Yes."""
    prompt = (enhanced_prompt or original_prompt or "").strip()[:1200]
    original = (original_prompt or "").strip()[:1200]
    pa = _pack(
        action_type="decision_report",
        title="Confirm this decision question?",
        message="Tap Yes to generate a structured decision report from the enhanced question above.",
        payload={
            "decision_prompt": prompt,
            "original_prompt": original,
            "enhanced_prompt": prompt,
            "manual_mode": True,
        },
        blocks=["generate_decision_report"],
    )
    dts = _ensure_state(thread)
    dts["pending_confirmation"] = True
    dts["pending_prompt"] = prompt
    thread["pending_action"] = pa
    ds = thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False})
    ds["decision_report"] = False
    return pa


def set_suggestion_pending(
    thread: dict[str, Any],
    suggestion: dict[str, Any],
    *,
    decision_prompt: str = "",
) -> dict[str, Any] | None:
    stype = str(suggestion.get("type") or "").strip()
    if stype not in {"decision_report", "role_mode"}:
        return None
    existing = thread.get("pending_action")
    if isinstance(existing, dict) and existing.get("type") == "clarification":
        return existing  # clarification wins
    payload: dict[str, Any] = {"decision_prompt": (decision_prompt or "").strip()[:1200]}
    if stype == "decision_report":
        dts = _ensure_state(thread)
        prompt = payload["decision_prompt"] or str(dts.get("pending_prompt") or "").strip()
        if prompt:
            payload["decision_prompt"] = prompt
        pa = _pack(
            action_type="decision_report",
            title=str(suggestion.get("title") or "Turn this into a decision report?"),
            message=str(
                suggestion.get("message")
                or "I can structure this into options, trade-offs, risks, and an action plan."
            ),
            payload=payload,
            blocks=["generate_decision_report"],
        )
    else:
        pa = _pack(
            action_type="role_mode",
            title=str(suggestion.get("title") or "Enter Role Mode?"),
            message=str(
                suggestion.get("message")
                or "Role Mode keeps story state consistent while preserving this chat history."
            ),
            payload={},
            blocks=["send_message"],
        )
    thread["pending_action"] = pa
    return pa


def sync_decision_pending_from_trigger(thread: dict[str, Any], *, last_user_message: str = "") -> dict[str, Any] | None:
    existing = thread.get("pending_action")
    if isinstance(existing, dict) and existing.get("type") == "clarification":
        return existing
    dts = _ensure_state(thread)
    if not bool(dts.get("pending_confirmation")):
        if isinstance(existing, dict) and existing.get("type") == "decision_report":
            clear_pending_action(thread)
        return None
    ds = thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False})
    if ds.get("decision_report"):
        return None
    prompt = str(dts.get("pending_prompt") or last_user_message or "").strip()
    return set_suggestion_pending(
        thread,
        {
            "type": "decision_report",
            "title": "Turn this into a decision report?",
            "message": "I can structure this into options, trade-offs, risks, consequences, and an action plan.",
        },
        decision_prompt=prompt,
    )


def thread_has_decision_report_artifact(thread: dict[str, Any]) -> bool:
    for m in thread.get("messages") or []:
        meta = m.get("metadata")
        if isinstance(meta, dict) and str(meta.get("type") or "") == "decision_report_artifact":
            return True
    return False


def derive_pending_clarification_from_state(thread: dict[str, Any]) -> dict[str, Any] | None:
    st = thread.get("clarification_state")
    if not isinstance(st, dict):
        return None
    questions = st.get("pending_questions")
    if not isinstance(questions, list) or not questions:
        return None
    meta = st.get("pending_meta") if isinstance(st.get("pending_meta"), dict) else {}
    note = str(st.get("pending_note") or "")
    blocks = st.get("pending_blocks")
    blk = blocks if isinstance(blocks, list) and blocks else ["send_message", "generate_decision_report"]
    return set_clarification_pending(
        thread,
        questions=questions,
        meta=meta,
        note=note,
        blocks=[str(b) for b in blk],
    )


def return_thread_to_normal_chat_after_report(thread: dict[str, Any]) -> None:
    """After a report artifact, keep chatting in normal mode so new decisions can be offered."""
    if str(thread.get("mode") or "") == "decision_report":
        thread["mode"] = "normal"


def derive_pending_action(thread: dict[str, Any], *, last_user_message: str = "") -> dict[str, Any] | None:
    clar = derive_pending_clarification_from_state(thread)
    if clar:
        return clar

    existing = thread.get("pending_action")
    if isinstance(existing, dict) and existing.get("type") == "clarification":
        return existing

    dts = _ensure_state(thread)
    if bool(dts.get("pending_confirmation")):
        synced = sync_decision_pending_from_trigger(thread, last_user_message=last_user_message)
        if synced:
            return synced
        if isinstance(existing, dict) and existing.get("type") == "decision_report":
            return existing

    if isinstance(existing, dict) and existing.get("type") == "role_mode":
        return existing

    if isinstance(existing, dict) and existing.get("type") == "decision_report":
        clear_pending_action(thread)

    return None


def enrich_thread_with_pending_action(thread: dict[str, Any], *, last_user_message: str = "") -> dict[str, Any]:
    """Attach `pending_action` for API responses; does not mutate unrelated fields."""
    msgs = thread.get("messages") or []
    last_u = last_user_message
    if not last_u:
        for m in reversed(msgs):
            if str(m.get("role") or "") == "user":
                last_u = str(m.get("content") or "").strip()
                break
    pa = derive_pending_action(thread, last_user_message=last_u)
    if pa:
        thread["pending_action"] = pa
    else:
        thread.pop("pending_action", None)
    return thread


def metrics_resolution(action_type: str, resolution: str) -> dict[str, str]:
    return {
        "pending_action_type": action_type,
        "pending_action_resolution": resolution,
        "pending_action_resolved_at": _now_iso(),
    }
