"""Pending action suppressed after a decision report artifact exists."""

from __future__ import annotations

from foresight_x.chat.pending_action import derive_pending_action, set_suggestion_pending


def test_no_decision_offer_after_report_artifact() -> None:
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
            "pending_prompt": "Should I break up?",
        },
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
    }
    set_suggestion_pending(
        thread,
        {"type": "decision_report", "title": "Turn this into a decision report?", "message": "..."},
    )
    pa = derive_pending_action(thread, last_user_message="Should I break up?")
    assert pa is None
