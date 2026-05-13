"""Shared conversational turn for Shadow Chat and Slime Buddy (voice-first).

Keeps thread persistence, memory retrieval, and decision-intent detection aligned
with `stream_shadow_chat_message` without duplicating the full SSE clarification flow.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

from foresight_x.chat.intent_detector import detect_chat_intent
from foresight_x.chat.slime_intent import classify_slime_intent, merge_with_decision_intent
from foresight_x.chat.thread_store import append_message, create_thread, load_thread, save_thread
from foresight_x.config import Settings
from foresight_x.perception.clarify_gate import merge_clarification_answers
from foresight_x.schemas import SlimePersona
from foresight_x.shadow.chat import run_shadow_turn
from foresight_x.shadow.thread_context import append_temporary_context_items, format_temporary_context_prompt
from foresight_x.shadow.thread_summary import maybe_update_thread_summary
from foresight_x.voice.slime_identity import (
    format_user_nickname_reply,
    get_effective_slime_persona,
    is_slime_identity_question,
    is_user_saved_nickname_question,
)
from foresight_x.voice.slime_persona_prompt import (
    build_slime_persona_prompt,
    build_slime_self_identity_prompt,
    decision_mode_spoken_prompt,
)
from foresight_x.voice.slime_self_model import get_effective_slime_self_model
from foresight_x.voice.slime_profile_nl import try_apply_slime_profile_from_chat_message
from foresight_x.voice.slime_self_reply import answer_slime_self_question

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
    slime_name: str,
    persona: SlimePersona,
) -> dict[str, Any] | None:
    if not base or base.get("type") != "decision_report":
        return None
    dp = user_message.strip()
    if len(dp) > 1200:
        dp = dp[:1200]
    display_text, spoken_prompt = decision_mode_spoken_prompt(slime_name=slime_name, persona=persona)
    return {
        "should_show": True,
        "display_text": display_text,
        "spoken_prompt": spoken_prompt,
        "description": (
            "I can turn this into a structured decision report with options, trade-offs, risks, "
            "consequences, and an action plan."
        ),
        "decision_prompt": dp,
        "confidence": 0.86,
        "shadow_suggestion": base,
    }


def maybe_slime_voice_preflight_reply(raw_msg: str, *, settings: Settings) -> tuple[str, str] | None:
    """
    Short-circuit replies for Slime Buddy / voice (nickname + slime self identity).
    Returns (intent_label, reply_text) or None.
    """
    if is_user_saved_nickname_question(raw_msg):
        eff = get_effective_slime_persona(settings)
        return "slime_user_nickname", format_user_nickname_reply(eff)

    si = classify_slime_intent(raw_msg)
    legacy_self = is_slime_identity_question(raw_msg)
    if si.intent == "slime_self_question" and si.confidence >= 0.5:
        eff = get_effective_slime_persona(settings)
        sm = get_effective_slime_self_model(settings.foresight_user_id, settings=settings)
        return "slime_self_question", answer_slime_self_question(raw_msg, sm, eff.persona)
    if legacy_self:
        eff = get_effective_slime_persona(settings)
        sm = get_effective_slime_self_model(settings.foresight_user_id, settings=settings)
        return "slime_self_question", answer_slime_self_question(raw_msg, sm, eff.persona)
    return None


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
    llm_model: str | None = None,
) -> dict[str, Any]:
    """
    One assistant reply turn using the same core pathway as Shadow streaming:
    intent → memory mode → run_shadow_turn → persist messages → optional decision suggestion.
    Does not run clarification cards (Slime voice defers; Shadow stream handles those separately).
    """
    raw_msg = user_message.strip()
    if not raw_msg:
        raise ValueError("empty_message")

    if source == "slime_voice":
        pre = maybe_slime_voice_preflight_reply(raw_msg, settings=settings)
        if pre is not None:
            intent_label, text = pre
            mode = str(thread.get("mode") or "normal")
            meta_extra: dict[str, Any] = {"interaction_source": source, "modality": modality}
            user_row = append_message(
                thread,
                role="user",
                content=raw_msg,
                mode=mode,
                intent=intent_label,
                metadata_extra=meta_extra,
            )
            user_msg_id = str(user_row.get("id") or "")
            append_message(
                thread,
                role="assistant",
                content=text,
                mode=mode,
                intent=intent_label,
                memory_used=False,
                profile_updated=False,
            )
            maybe_update_thread_summary(thread, settings=settings)
            save_thread(thread)
            return {
                "thread_id": str(thread.get("thread_id") or ""),
                "user_message_id": user_msg_id,
                "assistant_text": text,
                "spoken_sequence": [text],
                "intent": intent_label,
                "decision_suggestion": None,
                "shadow_suggestion": None,
                "memory_updates": [],
                "evidence_items": [],
                "frontend_action": None,
            }

        applied_nl, nl_reply = try_apply_slime_profile_from_chat_message(raw_msg, settings=settings)
        if applied_nl and nl_reply:
            mode = str(thread.get("mode") or "normal")
            meta_extra = {"interaction_source": source, "modality": modality}
            user_row = append_message(
                thread,
                role="user",
                content=raw_msg,
                mode=mode,
                intent="slime_profile_chat_patch",
                metadata_extra=meta_extra,
            )
            user_msg_id = str(user_row.get("id") or "")
            append_message(
                thread,
                role="assistant",
                content=nl_reply,
                mode=mode,
                intent="slime_profile_chat_patch",
                memory_used=False,
                profile_updated=True,
            )
            maybe_update_thread_summary(thread, settings=settings)
            save_thread(thread)
            return {
                "thread_id": str(thread.get("thread_id") or ""),
                "user_message_id": user_msg_id,
                "assistant_text": nl_reply,
                "spoken_sequence": [nl_reply],
                "intent": "slime_profile_chat_patch",
                "decision_suggestion": None,
                "shadow_suggestion": None,
                "memory_updates": [],
                "evidence_items": [],
                "frontend_action": {"type": "slime_profile_refresh", "route": "", "payload": {}},
            }

    effective_message = merge_clarification_answers(raw_msg, clarification_answers)
    mode = str(thread.get("mode") or "normal")
    recent_for_intent = thread.get("messages", [])[-8:]
    intent_probe = effective_message.strip() if effective_message.strip() != raw_msg.strip() else raw_msg
    intent = detect_chat_intent(intent_probe, recent_for_intent)
    slime_lane = classify_slime_intent(intent_probe)
    slime_lane = merge_with_decision_intent(slime_lane, intent.intent == "decision_candidate")
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

    eff = get_effective_slime_persona(settings)
    slime_name = eff.name
    persona_merged = eff.persona
    user_ref = eff.user_nickname_for_address
    slime_addendum: str | None = None
    synthesis_frame: Literal["shadow", "slime_buddy"] = "shadow"
    slime_hint: str | None = None
    if source == "slime_voice":
        synthesis_frame = "slime_buddy"
        self_model = get_effective_slime_self_model(settings.foresight_user_id, settings=settings)
        identity_pack = build_slime_self_identity_prompt(self_model, persona_merged)
        style_pack = build_slime_persona_prompt(
            persona_merged,
            "shadow_chat",
            slime_name=slime_name,
            user_ref=user_ref,
            slime_profile_saved=eff.profile_saved,
        )
        slime_addendum = f"{identity_pack}\n\n--- Persona style ---\n{style_pack}"
        slime_hint = slime_lane.intent if slime_lane.intent != "general_chat" else None

    try:
        out = run_shadow_turn(
            msgs,
            settings=settings,
            thread_id=str(thread.get("thread_id") or ""),
            retrieval_mode=retrieval_mode,
            report_revision_decision_id=rev_id,
            working_summary=str(thread.get("working_summary") or ""),
            temporary_context_prompt=format_temporary_context_prompt(thread),
            slime_voice_style_addendum=slime_addendum,
            synthesis_frame=synthesis_frame,
            slime_intent_hint=slime_hint,
            llm_model=llm_model,
        )
    except Exception as e:
        _log.exception("run_shadow_turn failed in process_conversation_turn")
        raise

    append_temporary_context_items(thread, out.thread_only_items)
    text = out.reply.strip()
    profile_updates = [x for x in (out.profile_record_texts or []) if _should_store_profile_fact(x)]
    profile_update_details = list(out.profile_memory_events or [])
    if not profile_updates:
        # Fallback capture keeps SlimBody/SlimChat parity when model output omits memory_facts.
        try:
            from foresight_x.profile.proactive_memory import capture_turn_memory

            proactive = capture_turn_memory(
                settings=settings,
                user_text=effective_message,
                assistant_text=text,
                source_chat="slime_voice" if source == "slime_voice" else "shadow_chat",
                source_thread_id=str(thread.get("thread_id") or ""),
                source_message_id=user_msg_id,
                llm_model=llm_model,
            )
            if proactive.saved_texts:
                profile_updates = [x for x in proactive.saved_texts if _should_store_profile_fact(x)]
                profile_update_details = list(proactive.events or [])
        except Exception:
            _log.debug("proactive memory fallback failed", exc_info=True)

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
                "details": profile_update_details[:4],
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
        decision_suggestion = _enrich_decision_suggestion_for_voice(
            suggestion,
            user_message=raw_msg,
            slime_name=slime_name,
            persona=persona_merged,
        )
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
        "memory_update_details": profile_update_details,
        "evidence_items": [],
        "frontend_action": frontend_action,
    }
