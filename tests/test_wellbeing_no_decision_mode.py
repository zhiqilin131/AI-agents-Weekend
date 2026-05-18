"""Rimumu (wellbeing) must not offer or enter Foresight Decision Mode."""

from __future__ import annotations

from foresight_x.chat.conversation_service import _intent_without_decision_for_wellbeing
from foresight_x.chat.decision_trigger import evaluate_decision_trigger
from foresight_x.chat.intent_detector import ChatIntentResult
from foresight_x.slime.identity import slime_supports_decision_mode


def test_slime_supports_decision_mode_only_generalized() -> None:
    assert slime_supports_decision_mode("generalized") is True
    assert slime_supports_decision_mode("wellbeing") is False
    assert slime_supports_decision_mode(thread={"slime_type": "wellbeing"}) is False


def test_wellbeing_strips_decision_intent() -> None:
    raw = ChatIntentResult(
        intent="decision_candidate",
        confidence=0.9,
        reasons=["should i"],
    )
    out = _intent_without_decision_for_wellbeing("wellbeing", raw)
    assert out.intent == "normal"
    assert "wellbeing_no_decision_mode" in out.reasons


def test_wellbeing_thread_never_offers_decision_suggestion() -> None:
    thread = {"slime_type": "wellbeing", "decision_mode_state": {}}
    ev = evaluate_decision_trigger(
        thread=thread,
        user_action="send_message",
        user_message="Should I move to a new apartment or stay?",
        intent_label="decision_candidate",
        intent_confidence=0.95,
    )
    assert ev.should_offer_suggestion is False
    assert ev.effective_action == "send_message"
    assert ev.reason == "wellbeing_no_decision_mode"
