"""Pending action after a prior decision report artifact in the same thread."""

from __future__ import annotations

from foresight_x.chat.pending_action import (
    derive_pending_action,
    return_thread_to_normal_chat_after_report,
    set_suggestion_pending,
)


def test_new_decision_offer_allowed_after_report_artifact() -> None:
    thread: dict = {
        "mode": "decision_report",
        "messages": [
            {
                "role": "assistant",
                "metadata": {
                    "type": "decision_report_artifact",
                    "title": "Decision Report",
                    "status": "complete",
                },
            }
        ],
        "decision_trigger_state": {
            "pending_confirmation": True,
            "pending_prompt": "Should I go to the NBA playoffs or the Drake performance?",
        },
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
    }
    set_suggestion_pending(
        thread,
        {"type": "decision_report", "title": "Turn this into a decision report?", "message": "..."},
        decision_prompt="Should I go to the NBA playoffs or the Drake performance?",
    )
    pa = derive_pending_action(
        thread,
        last_user_message="Should I go to the NBA playoffs or the Drake performance?",
    )
    assert pa is not None
    assert pa["type"] == "decision_report"
    assert "NBA" in str(pa.get("payload", {}).get("decision_prompt") or "")


def test_return_thread_to_normal_chat_after_report() -> None:
    thread: dict = {
        "mode": "decision_report",
        "pending_action": {
            "id": "pa-1",
            "type": "decision_report",
            "title": "Confirm?",
            "message": "Tap Yes",
            "blocks": ["generate_decision_report"],
            "payload": {"manual_mode": True},
        },
        "decision_trigger_state": {"pending_confirmation": True, "pending_prompt": "A or B?"},
    }
    return_thread_to_normal_chat_after_report(thread)
    assert thread["mode"] == "normal"
    assert "pending_action" not in thread
    assert thread["decision_trigger_state"]["pending_confirmation"] is False


def test_stale_manual_confirm_hidden_after_report_artifact() -> None:
    thread: dict = {
        "messages": [
            {
                "role": "assistant",
                "metadata": {"type": "decision_report_artifact", "status": "complete"},
            }
        ],
        "pending_action": {
            "id": "pa-manual",
            "type": "decision_report",
            "title": "Confirm this decision question?",
            "message": "Tap Yes to generate",
            "blocks": ["generate_decision_report"],
            "payload": {"manual_mode": True, "decision_prompt": "Pick A or B"},
        },
        "decision_trigger_state": {"pending_confirmation": False},
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
    }
    pa = derive_pending_action(thread)
    assert pa is None
    assert "pending_action" not in thread
