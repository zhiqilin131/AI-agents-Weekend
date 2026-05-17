"""Shared kwargs for run_shadow_turn from thread + message context."""

from __future__ import annotations

from typing import Any

from foresight_x.chat.slime_intent import classify_slime_intent, merge_with_decision_intent
from foresight_x.config import Settings
from foresight_x.slime.identity import SlimeType, resolve_slime_type_from_thread
from foresight_x.slime.prompts import build_generalized_turn_addendum, build_wellbeing_turn_addendum
from foresight_x.slime.wellbeing_router import WellbeingRouteResult, is_safety_escalation_message
from foresight_x.slime.wellbeing_session import build_wellbeing_session_prompt_block

_WELLBEING_ROUTE_KEY = "__wellbeing_route__"


def resolve_wellbeing_triage_llm(
    settings: Settings,
    *,
    llm_model: str | None = None,
) -> Any | None:
    """Lightweight LLM for protocol triage; None when API key missing (scoring fallback)."""
    if not (settings.openai_api_key or "").strip():
        return None
    from foresight_x.orchestration.llm_factory import build_openai_llm

    return build_openai_llm(settings, temperature=0.2, model=llm_model)


def pop_wellbeing_route(turn_kw: dict[str, Any]) -> WellbeingRouteResult | None:
    """Extract route metadata before passing kwargs to run_shadow_turn."""
    raw = turn_kw.pop(_WELLBEING_ROUTE_KEY, None)
    return raw if isinstance(raw, WellbeingRouteResult) else None


def build_slime_turn_kwargs(
    settings: Settings,
    thread: dict[str, Any],
    *,
    intent_probe: str,
    chat_intent_label: str,
    user_message: str = "",
    llm: Any | None = None,
    llm_model: str | None = None,
) -> dict[str, Any]:
    """
    When thread has a slime_type (or legacy slime_voice source), return run_shadow_turn kwargs.
    Legacy shadow threads without slime_type return {}.
    """
    slime_type: SlimeType | None = resolve_slime_type_from_thread(thread)
    if not slime_type:
        return {}

    slime_lane = classify_slime_intent(intent_probe)
    hint = slime_lane.intent if slime_lane.intent != "general_chat" else None

    if slime_type == "wellbeing":
        probe = intent_probe or user_message
        triage_llm = llm if llm is not None else resolve_wellbeing_triage_llm(settings, llm_model=llm_model)
        addendum, route = build_wellbeing_turn_addendum(
            settings,
            user_message=probe,
            thread=thread,
            llm=triage_llm,
        )
        session_block = build_wellbeing_session_prompt_block(thread)
        addendum = f"{session_block}\n\n{addendum}"
        return {
            "slime_voice_style_addendum": addendum,
            "synthesis_frame": "slime_buddy",
            "slime_type": slime_type,
            "slime_intent_hint": hint,
            _WELLBEING_ROUTE_KEY: route,
        }

    slime_lane = merge_with_decision_intent(slime_lane, chat_intent_label == "decision_candidate")
    hint = slime_lane.intent if slime_lane.intent != "general_chat" else None
    addendum = build_generalized_turn_addendum(settings)
    return {
        "slime_voice_style_addendum": addendum,
        "synthesis_frame": "slime_buddy",
        "slime_type": slime_type,
        "slime_intent_hint": hint,
    }


def wellbeing_safety_short_circuit(
    thread: dict[str, Any],
    user_message: str,
) -> bool:
    """True when wellbeing mode must not call the main LLM turn."""
    st = resolve_slime_type_from_thread(thread)
    return st == "wellbeing" and is_safety_escalation_message(user_message)
