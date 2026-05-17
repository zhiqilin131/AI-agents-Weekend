"""Shared conversational turn for Shadow Chat and Slime Buddy (voice-first).

Keeps thread persistence, memory retrieval, and decision-intent detection aligned
with `stream_shadow_chat_message` without duplicating the full SSE clarification flow.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from foresight_x.chat.intent_detector import ChatIntentResult, detect_chat_intent
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
from foresight_x.voice.memory_evidence import build_turn_memory_evidence
from foresight_x.slime.turn_params import (
    build_slime_turn_kwargs,
    pop_wellbeing_route,
    wellbeing_safety_short_circuit,
)
from foresight_x.slime.wellbeing_router import build_safety_escalation_reply

_log = logging.getLogger(__name__)


def _try_refine_thread_title(
    settings: Settings,
    thread: dict[str, Any],
    user_message: str,
    *,
    llm_model: str | None = None,
) -> str | None:
    try:
        from foresight_x.chat.thread_title import refine_thread_title_first_turn
        from foresight_x.ui.cli import _build_context

        ctx_title, _ = _build_context(settings, llm_model=llm_model)
        title = refine_thread_title_first_turn(thread, user_message, llm=ctx_title.llm)
        if title:
            save_thread(thread)
        return title
    except Exception:
        _log.debug("thread title refine failed", exc_info=True)
        return None

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
            "actions": ["generate_decision_report", "continue_normally", "dismiss_suggestion"],
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


def process_manual_decision_voice_turn(
    *,
    settings: Settings,
    thread: dict[str, Any],
    transcript: str,
    llm: Any,
    profile: Any | None = None,
    on_reply_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Manual Decision Mode for Slime voice: enhance transcript, confirm, set pending action."""
    from foresight_x.chat.manual_decision_mode import build_manual_decision_confirmation
    from foresight_x.chat.pending_action import set_manual_decision_pending
    from foresight_x.perception.query_enhance import prepare_decision_text
    from foresight_x.profile.store import load_user_profile

    raw = (transcript or "").strip()
    if not raw:
        raise ValueError("no_speech_detected")

    from foresight_x.slime.identity import slime_supports_decision_mode

    if not slime_supports_decision_mode(thread=thread):
        raise ValueError("decision_mode_not_available_for_slime_type")

    prof = profile if profile is not None else load_user_profile(settings)
    original, enhanced = prepare_decision_text(raw, llm, profile=prof)
    assistant_text = build_manual_decision_confirmation(original=original, enhanced=enhanced)
    mode = str(thread.get("mode") or "normal")

    append_message(
        thread,
        role="user",
        content=raw,
        mode=mode,
        intent="decision_candidate",
        metadata_extra={"interaction_source": "slime_voice", "modality": "voice", "manual_decision_mode": True},
    )
    append_message(
        thread,
        role="assistant",
        content=assistant_text,
        mode=mode,
        intent="decision_candidate",
        memory_used=False,
    )
    set_manual_decision_pending(thread, original_prompt=original, enhanced_prompt=enhanced)
    maybe_update_thread_summary(thread, settings=settings)
    save_thread(thread)

    eff = get_effective_slime_persona(settings, slime_type=_slime_type_for_thread(thread))  # type: ignore[arg-type]
    shadow_sug = {
        "type": "decision_report",
        "title": "Confirm this decision question?",
        "message": "Tap Yes to generate a structured decision report from the enhanced question above.",
        "actions": ["generate_decision_report", "continue_normally", "dismiss_suggestion"],
        "manual_mode": True,
        "decision_prompt": enhanced,
    }
    decision_suggestion = _enrich_decision_suggestion_for_voice(
        shadow_sug,
        user_message=enhanced,
        slime_name=eff.name,
        persona=eff.persona,
    )
    if decision_suggestion:
        decision_suggestion["decision_prompt"] = enhanced
        decision_suggestion["description"] = (
            "Tap **Yes** below when you're ready and I'll generate the structured decision report."
        )

    if on_reply_delta is not None:
        chunk = 48
        for i in range(0, len(assistant_text), chunk):
            on_reply_delta(assistant_text[i : i + chunk])

    spoken = (
        (decision_suggestion or {}).get("spoken_prompt") or assistant_text
    ).strip()
    return {
        "thread_id": str(thread.get("thread_id") or ""),
        "assistant_text": assistant_text,
        "spoken_sequence": [spoken] if spoken else [assistant_text],
        "intent": "decision_candidate",
        "decision_suggestion": decision_suggestion,
        "shadow_suggestion": shadow_sug,
        "memory_updates": [],
        "memory_update_details": [],
        "evidence_items": [],
        "frontend_action": {
            "type": "show_decision_mode_confirmation",
            "payload": {
                "decision_prompt": enhanced,
                "display_text": (decision_suggestion or {}).get("display_text"),
                "spoken_prompt": spoken,
                "manual_mode": True,
            },
        },
    }


def _slime_type_for_thread(thread: dict[str, Any]) -> str:
    from foresight_x.slime.identity import resolve_slime_type_from_thread

    return resolve_slime_type_from_thread(thread) or "generalized"


def _intent_without_decision_for_wellbeing(
    slime_type: str,
    intent: ChatIntentResult,
) -> ChatIntentResult:
    if slime_type != "wellbeing" or intent.intent != "decision_candidate":
        return intent
    return ChatIntentResult(
        intent="normal",
        confidence=0.0,
        reasons=[*intent.reasons, "wellbeing_no_decision_mode"],
        suggested_action="continue",
    )


def maybe_slime_voice_preflight_reply(
    raw_msg: str,
    *,
    settings: Settings,
    thread: dict[str, Any],
) -> tuple[str, str] | None:
    """
    Short-circuit replies for Slime Buddy / voice (nickname + slime self identity).
    Returns (intent_label, reply_text) or None.
    """
    from foresight_x.slime.identity import SlimeType

    slime_type: SlimeType = _slime_type_for_thread(thread)  # type: ignore[assignment]

    if is_user_saved_nickname_question(raw_msg):
        eff = get_effective_slime_persona(settings, slime_type=slime_type)
        return "slime_user_nickname", format_user_nickname_reply(eff)

    si = classify_slime_intent(raw_msg)
    legacy_self = is_slime_identity_question(raw_msg)
    if si.intent == "slime_self_question" and si.confidence >= 0.5:
        eff = get_effective_slime_persona(settings, slime_type=slime_type)
        sm = get_effective_slime_self_model(
            settings.foresight_user_id,
            settings=settings,
            slime_type=slime_type,
        )
        return (
            "slime_self_question",
            answer_slime_self_question(raw_msg, sm, eff.persona, slime_type=slime_type),
        )
    if legacy_self:
        eff = get_effective_slime_persona(settings, slime_type=slime_type)
        sm = get_effective_slime_self_model(
            settings.foresight_user_id,
            settings=settings,
            slime_type=slime_type,
        )
        return (
            "slime_self_question",
            answer_slime_self_question(raw_msg, sm, eff.persona, slime_type=slime_type),
        )
    return None


def ensure_slime_voice_thread(
    user_id: str,
    thread_id: str | None,
    *,
    slime_type: str | None = None,
) -> dict[str, Any]:
    """Load or create a chat thread used by Slime Buddy; tag with source for analytics."""
    from foresight_x.slime.identity import normalize_slime_type

    st = normalize_slime_type(slime_type) or "generalized"
    if thread_id:
        thread = load_thread(thread_id, user_id=user_id)
        thread.setdefault("source", "slime_voice")
        thread["slime_type"] = st
        save_thread(thread)
        return thread
    t = create_thread(user_id=user_id, slime_type=st)
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
    on_reply_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """
    One assistant reply turn using the same core pathway as Shadow streaming:
    intent → memory mode → run_shadow_turn → persist messages → optional decision suggestion.
    Does not run clarification cards (Slime voice defers; Shadow stream handles those separately).
    """
    raw_msg = user_message.strip()
    if not raw_msg:
        raise ValueError("empty_message")

    from foresight_x.slime.identity import SlimeType, get_slime_identity

    slime_type: SlimeType = _slime_type_for_thread(thread)  # type: ignore[assignment]
    ident = get_slime_identity(slime_type)
    eff_persona = get_effective_slime_persona(settings, slime_type=slime_type)
    slime_name = ident.ui_spoken_name
    persona_merged = ident.fixed_persona

    if source == "slime_voice":
        pre = maybe_slime_voice_preflight_reply(raw_msg, settings=settings, thread=thread)
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
            _try_refine_thread_title(settings, thread, raw_msg, llm_model=llm_model)
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
            _try_refine_thread_title(settings, thread, raw_msg, llm_model=llm_model)
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
    # Slime voice: heuristic intent is enough for most turns (saves one LLM hop); shadow text keeps LLM refine.
    intent = detect_chat_intent(
        intent_probe,
        recent_for_intent,
        llm_enabled=(source != "slime_voice"),
    )
    intent = _intent_without_decision_for_wellbeing(slime_type, intent)
    slime_lane = classify_slime_intent(intent_probe)
    if slime_type == "wellbeing":
        retrieval_mode = "chat_fast"
    else:
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
    _try_refine_thread_title(settings, thread, effective_message, llm_model=llm_model)

    msgs = _slice_shadow_messages(thread)
    ar_ctx = thread.get("active_report_context") or {}
    rev_id: str | None = None
    if isinstance(ar_ctx, dict) and str(ar_ctx.get("mode") or "") == "revision":
        d0 = str(ar_ctx.get("decision_id") or "").strip()
        if d0:
            rev_id = d0

    if wellbeing_safety_short_circuit(thread, effective_message):
        text = build_safety_escalation_reply()
        append_message(
            thread,
            role="assistant",
            content=text,
            mode=mode,
            intent="wellbeing_safety_escalation",
            memory_used=False,
            profile_updated=False,
            metadata_extra={**meta_extra, "wellbeing_protocol": "safety_escalation"},
        )
        maybe_update_thread_summary(thread, settings=settings)
        save_thread(thread)
        stored_title = str(thread.get("title") or "").strip()
        return {
            "thread_id": str(thread.get("thread_id") or ""),
            "user_message_id": user_msg_id,
            "assistant_text": text,
            "spoken_sequence": [text],
            "intent": "wellbeing_safety_escalation",
            "decision_suggestion": None,
            "shadow_suggestion": None,
            "memory_updates": [],
            "evidence_items": [],
            "frontend_action": None,
            "thread_title": stored_title or None,
        }

    turn_kw = build_slime_turn_kwargs(
        settings,
        thread,
        intent_probe=intent_probe,
        chat_intent_label=intent.intent,
        user_message=effective_message,
        llm_model=llm_model,
    )
    wellbeing_route = pop_wellbeing_route(turn_kw)
    synthesis_frame: Literal["shadow", "slime_buddy"] = turn_kw.get("synthesis_frame", "shadow")  # type: ignore[assignment]
    if source == "slime_voice" and not turn_kw:
        eff = get_effective_slime_persona(settings, slime_type=slime_type)
        self_model = get_effective_slime_self_model(
            settings.foresight_user_id,
            settings=settings,
            slime_type=slime_type,
        )
        voice_ident = get_slime_identity(slime_type)
        identity_pack = build_slime_self_identity_prompt(self_model, voice_ident.fixed_persona)
        style_pack = build_slime_persona_prompt(
            voice_ident.fixed_persona,
            "shadow_chat",
            slime_name=voice_ident.ui_spoken_name,
            user_ref=eff.user_nickname_for_address,
            slime_profile_saved=True,
        )
        turn_kw = {
            "slime_voice_style_addendum": f"{identity_pack}\n\n--- Persona style ---\n{style_pack}",
            "synthesis_frame": "slime_buddy",
            "slime_type": slime_type,
            "slime_intent_hint": slime_lane.intent if slime_lane.intent != "general_chat" else None,
        }
        synthesis_frame = "slime_buddy"

    try:
        out = run_shadow_turn(
            msgs,
            settings=settings,
            thread_id=str(thread.get("thread_id") or ""),
            retrieval_mode=retrieval_mode,
            report_revision_decision_id=rev_id,
            working_summary=str(thread.get("working_summary") or ""),
            temporary_context_prompt=format_temporary_context_prompt(thread),
            llm_model=llm_model,
            reply_delta_callback=on_reply_delta if source == "slime_voice" else None,
            **turn_kw,
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
                wellbeing_mode=slime_type == "wellbeing",
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
    if slime_type == "wellbeing":
        from foresight_x.slime.wellbeing_session import record_wellbeing_turn

        record_wellbeing_turn(
            thread,
            user_message=effective_message,
            route=wellbeing_route,
            assistant_preview=text,
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
    from foresight_x.slime.identity import slime_supports_decision_mode

    suggestion = (
        _build_shadow_suggestion(intent.intent, dismissed=dismissed)
        if slime_supports_decision_mode(slime_type=slime_type)
        else None
    )

    decision_suggestion: dict[str, Any] | None = None
    frontend_action: dict[str, Any] | None = None
    if source == "slime_voice" and slime_supports_decision_mode(slime_type=slime_type):
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
    # The UI now shows Decision Mode as a bubble action chip; keep voice focused on the answer.
    spoken_sequence: list[str] = [text]
    evidence_items = build_turn_memory_evidence(
        retrieved_facts=getattr(out, "retrieved_memory_facts", None) or [],
        used_text_facts=out.used_memory_facts or [],
    )

    stored_title = str(thread.get("title") or "").strip()
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
        "evidence_items": evidence_items,
        "frontend_action": frontend_action,
        "thread_title": stored_title or None,
    }
