"""Shared conversational turn for Shadow Chat and Slime Buddy (voice-first).

Keeps thread persistence, memory retrieval, and decision-intent detection aligned
with `stream_shadow_chat_message` without duplicating the full SSE clarification flow.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

from foresight_x.chat.intent_detector import detect_chat_intent
from foresight_x.chat.thread_store import append_message, create_thread, load_thread, save_thread
from foresight_x.config import Settings
from foresight_x.perception.clarify_gate import merge_clarification_answers
from foresight_x.shadow.chat import run_shadow_turn
from foresight_x.shadow.thread_context import append_temporary_context_items, format_temporary_context_prompt
from foresight_x.shadow.thread_summary import maybe_update_thread_summary

_log = logging.getLogger(__name__)

Source = Literal["shadow_chat", "slime_voice"]
Modality = Literal["text", "voice"]


def _slice_shadow_messages(thread: dict) -> list[dict]:
    """Last messages with metadata preserved (matches api_server._slice_shadow_messages)."""
    raw = thread.get("messages") or []
    chunk = raw[-24:] if len(raw) > 24 else raw
    out: list[dict] = []
    for m in chunk:
        if not isinstance(m, dict):
            continue
        meta = m.get("metadata")
        row: dict = {"role": m.get("role"), "content": m.get("content")}
        if isinstance(meta, dict):
            row["metadata"] = meta
        out.append(row)
    return out


def _should_store_profile_fact(item: str) -> bool:
    s = (item or "").strip()
    if len(s) < 8:
        return False
    lowered = s.lower()
    noisy = ["weather", "today", "just now", "lol", "haha"]
    if any(k in lowered for k in noisy):
        return False
    return True


def _build_shadow_suggestion(intent: str, *, dismissed: dict) -> dict[str, Any] | None:
    if intent == "roleplay_candidate" and not dismissed.get("role_mode", False):
        return {
            "type": "role_mode",
            "title": "Enter Role Mode?",
            "message": (
                "It looks like you may be starting a roleplay or simulation. Role Mode keeps the story "
                "state consistent while preserving this chat history."
            ),
            "actions": ["enter_role_mode", "continue_normally", "dismiss_suggestion"],
        }
    if intent == "decision_candidate" and not dismissed.get("decision_report", False):
        return {
            "type": "decision_report",
            "title": "Turn this into a decision report?",
            "message": "I can structure this into options, trade-offs, risks, consequences, and an action plan.",
            "actions": ["generate_decision_report", "continue_normally"],
        }
    return None


def _enrich_decision_suggestion_for_voice(
    base: dict[str, Any] | None,
    *,
    user_message: str,
) -> dict[str, Any] | None:
    if not base or base.get("type") != "decision_report":
        return None
    dp = user_message.strip()
    if len(dp) > 1200:
        dp = dp[:1200]
    return {
        "should_show": True,
        "display_text": "Activate Decision Mode?",
        "spoken_prompt": "Do you want me to activate Decision Mode for you?",
        "description": (
            "I can turn this into a structured decision report with options, trade-offs, risks, "
            "consequences, and an action plan."
        ),
        "decision_prompt": dp,
        "confidence": 0.86,
        "shadow_suggestion": base,
    }


def ensure_slime_voice_thread(user_id: str, thread_id: str | None) -> dict[str, Any]:
    """Load or create a chat thread used by Slime Buddy; tag with source for analytics."""
    if thread_id:
        thread = load_thread(thread_id, user_id=user_id)
        thread.setdefault("source", "slime_voice")
        save_thread(thread)
        return thread
    t = create_thread(user_id=user_id)
    t["source"] = "slime_voice"
    save_thread(t)
    return t


def process_conversation_turn(
    *,
    settings: Settings,
    user_id: str,
    thread: dict[str, Any],
    user_message: str,
    source: Source,
    modality: Modality,
    clarification_answers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    One assistant reply turn using the same core pathway as Shadow streaming:
    intent → memory mode → run_shadow_turn → persist messages → optional decision suggestion.
    Does not run clarification cards (Slime voice defers; Shadow stream handles those separately).
    """
    raw_msg = user_message.strip()
    if not raw_msg:
        raise ValueError("empty_message")

    effective_message = merge_clarification_answers(raw_msg, clarification_answers)
    mode = str(thread.get("mode") or "normal")
    recent_for_intent = thread.get("messages", [])[-8:]
    intent_probe = effective_message.strip() if effective_message.strip() != raw_msg.strip() else raw_msg
    intent = detect_chat_intent(intent_probe, recent_for_intent)
    retrieval_mode = "chat_deep" if intent.intent == "decision_candidate" else "chat_fast"

    meta_extra: dict[str, Any] = {"interaction_source": source, "modality": modality}
    user_row = append_message(
        thread,
        role="user",
        content=effective_message,
        mode=mode,
        intent=intent.intent,
        metadata_extra=meta_extra,
    )
    user_msg_id = str(user_row.get("id") or "")

    msgs = _slice_shadow_messages(thread)
    ar_ctx = thread.get("active_report_context") or {}
    rev_id: str | None = None
    if isinstance(ar_ctx, dict) and str(ar_ctx.get("mode") or "") == "revision":
        d0 = str(ar_ctx.get("decision_id") or "").strip()
        if d0:
            rev_id = d0

    try:
        out = run_shadow_turn(
            msgs,
            settings=settings,
            thread_id=str(thread.get("thread_id") or ""),
            retrieval_mode=retrieval_mode,
            report_revision_decision_id=rev_id,
            working_summary=str(thread.get("working_summary") or ""),
            temporary_context_prompt=format_temporary_context_prompt(thread),
        )
    except Exception as e:
        _log.exception("run_shadow_turn failed in process_conversation_turn")
        raise

    append_temporary_context_items(thread, out.thread_only_items)
    text = out.reply.strip()
    profile_updates = [x for x in (out.profile_record_texts or []) if _should_store_profile_fact(x)]

    append_message(
        thread,
        role="assistant",
        content=text,
        mode=mode,
        intent=intent.intent,
        memory_used=bool(out.used_memory_facts),
        profile_updated=bool(profile_updates),
    )
    if profile_updates:
        thread.setdefault("memory_events", []).append(
            {
                "kind": "profile_update",
                "items": profile_updates[:4],
                "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )

    maybe_update_thread_summary(thread, settings=settings)
    save_thread(thread)

    dismissed = thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False})
    suggestion = _build_shadow_suggestion(intent.intent, dismissed=dismissed)

    decision_suggestion: dict[str, Any] | None = None
    frontend_action: dict[str, Any] | None = None
    if source == "slime_voice":
        decision_suggestion = _enrich_decision_suggestion_for_voice(suggestion, user_message=raw_msg)
        if decision_suggestion:
            frontend_action = {
                "type": "show_decision_mode_confirmation",
                "payload": {
                    "decision_prompt": decision_suggestion.get("decision_prompt"),
                    "display_text": decision_suggestion.get("display_text"),
                    "spoken_prompt": decision_suggestion.get("spoken_prompt"),
                },
            }
    spoken_sequence: list[str] = [text]
    if decision_suggestion:
        spoken_sequence.append(str(decision_suggestion.get("spoken_prompt") or ""))

    return {
        "thread_id": str(thread.get("thread_id") or ""),
        "user_message_id": user_msg_id,
        "assistant_text": text,
        "spoken_sequence": spoken_sequence,
        "intent": intent.intent,
        "decision_suggestion": decision_suggestion,
        "shadow_suggestion": suggestion,
        "memory_updates": profile_updates,
        "evidence_items": [],
        "frontend_action": frontend_action,
    }
