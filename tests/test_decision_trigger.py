from __future__ import annotations

from foresight_x.chat.decision_trigger import evaluate_decision_trigger


def test_pending_confirmation_yes_auto_starts_report() -> None:
    thread = {"decision_trigger_state": {"pending_confirmation": True, "pending_prompt": "Should I switch jobs?"}}
    out = evaluate_decision_trigger(
        thread=thread,
        user_action="send_message",
        user_message="yes",
        intent_label="normal",
        intent_confidence=0.3,
    )
    assert out.effective_action == "generate_decision_report"
    assert out.auto_triggered is True
    assert "switch jobs" in out.decision_prompt


def test_soft_signals_offer_suggestion_with_no_cooldown() -> None:
    thread: dict = {}
    out = evaluate_decision_trigger(
        thread=thread,
        user_action="send_message",
        user_message="Should I move to city A or city B?",
        intent_label="decision_candidate",
        intent_confidence=0.8,
    )
    assert out.effective_action == "send_message"
    assert out.should_offer_suggestion is True


def test_explicit_decision_mode_offers_confirmation() -> None:
    thread: dict = {}
    out = evaluate_decision_trigger(
        thread=thread,
        user_action="send_message",
        user_message="Activate decision mode",
        intent_label="decision_candidate",
        intent_confidence=0.9,
    )
    assert out.effective_action == "send_message"
    assert out.should_offer_suggestion is True
    assert out.auto_triggered is False
    assert thread["decision_trigger_state"]["pending_confirmation"] is True


def test_dismiss_does_not_block_next_decision_detection() -> None:
    thread: dict = {}
    evaluate_decision_trigger(
        thread=thread,
        user_action="dismiss_suggestion",
        user_message="",
        intent_label="normal",
        intent_confidence=0.0,
    )
    out = evaluate_decision_trigger(
        thread=thread,
        user_action="send_message",
        user_message="Should I choose A or B?",
        intent_label="decision_candidate",
        intent_confidence=0.8,
    )
    assert out.should_offer_suggestion is True


def test_pending_confirmation_refreshes_on_new_decision_message() -> None:
    thread = {
        "decision_trigger_state": {
            "pending_confirmation": True,
            "pending_prompt": "Old prompt",
        }
    }
    out = evaluate_decision_trigger(
        thread=thread,
        user_action="send_message",
        user_message="Should I get the jersey or save for hotels?",
        intent_label="decision_candidate",
        intent_confidence=0.85,
    )
    assert out.should_offer_suggestion is True
    assert "jersey" in thread["decision_trigger_state"]["pending_prompt"]
