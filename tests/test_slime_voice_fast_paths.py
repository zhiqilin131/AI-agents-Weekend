"""Fast-path routing for Slime voice (latency without breaking calendar/decision)."""

from __future__ import annotations

from foresight_x.config import Settings
from foresight_x.voice.slime_voice_router import (
    SlimeVoiceContext,
    SlimeVoiceRouteResult,
    _looks_like_calendar_tool_request,
    _try_fast_decision_no_op,
    _try_fast_conversational_no_op,
    _try_fast_wellbeing_continue_no_op,
    apply_wellbeing_voice_route_policy,
    route_slime_voice_command,
)


def test_fast_decision_mode_skips_router_llm() -> None:
    r = _try_fast_decision_no_op("Activate decision mode. Shall I move to the new apartment or stay?")
    assert r is not None
    assert r.intent == "decision_candidate"
    assert r.tool_name == "no_op"


def test_calendar_reschedule_not_fast_decision() -> None:
    t = "Move my team standup on the calendar to 3pm tomorrow"
    assert _looks_like_calendar_tool_request(t) is True
    assert _try_fast_decision_no_op(t) is None
    assert _try_fast_conversational_no_op(t) is None


def test_route_calendar_create_still_uses_llm_or_tool_path(monkeypatch) -> None:
    """Calendar create must not be captured by fast decision/conversation paths."""
    called: list[str] = []

    def _fake_llm(*_a, **_k):
        class _R:
            tool_name = "create_calendar_draft"
            arguments = {"title": "Focus block"}
            requires_confirmation = False
            assistant_hint = "Drafting that."

        return _R()

    monkeypatch.setattr("foresight_x.voice.slime_voice_router.structured_predict", _fake_llm)
    settings = Settings(openai_api_key="sk-test", foresight_user_id="u_fast_cal")
    ctx = SlimeVoiceContext(user_id="u_fast_cal")
    out = route_slime_voice_command(
        "Add a focus block to my calendar tomorrow at 2pm",
        ctx,
        settings=settings,
    )
    assert out.tool_name == "create_calendar_draft"


def test_wellbeing_grounding_yes_routes_no_op() -> None:
    r = _try_fast_wellbeing_continue_no_op("Yes, please let's do that grounding technique.")
    assert r is not None
    assert r.tool_name == "no_op"


def test_wellbeing_blocks_open_shadow_chat() -> None:
    blocked = SlimeVoiceRouteResult(
        intent="chat",
        tool_name="open_shadow_chat",
        arguments={"prefill_message": "grounding"},
    )
    out = apply_wellbeing_voice_route_policy(blocked)
    assert out.tool_name == "no_op"
    assert out.arguments.get("blocked_tool") == "open_shadow_chat"


def test_wellbeing_voice_router_blocks_shadow_chat_llm(monkeypatch) -> None:
    def _fake_llm(*_a, **_k):
        class _R:
            tool_name = "open_shadow_chat"
            arguments = {"prefill_message": "grounding exercise"}
            requires_confirmation = False
            assistant_hint = None

        return _R()

    monkeypatch.setattr("foresight_x.voice.slime_voice_router.structured_predict", _fake_llm)
    settings = Settings(openai_api_key="sk-test", foresight_user_id="u_wb")
    ctx = SlimeVoiceContext(user_id="u_wb", slime_type="wellbeing")
    out = route_slime_voice_command(
        "Yes let's do the grounding technique",
        ctx,
        settings=settings,
    )
    assert out.tool_name == "no_op"
