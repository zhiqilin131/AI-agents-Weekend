"""Tests for thread-level pending_action (FOR-52)."""

from __future__ import annotations

from foresight_x.chat.pending_action import (
    clear_pending_action,
    derive_pending_action,
    enrich_thread_with_pending_action,
    set_clarification_pending,
    set_suggestion_pending,
    sync_decision_pending_from_trigger,
)


def test_clarification_blocks_decision_pending() -> None:
    thread: dict = {}
    set_suggestion_pending(
        thread,
        {
            "type": "decision_report",
            "title": "Report?",
            "message": "Structure this.",
        },
        decision_prompt="pick A or B",
    )
    assert thread["pending_action"]["type"] == "decision_report"

    set_clarification_pending(
        thread,
        questions=[{"id": "goal", "prompt": "What matters most?", "options": []}],
        meta={"why_this_question": "Goal uncertainty"},
    )
    assert thread["pending_action"]["type"] == "clarification"

    again = set_suggestion_pending(
        thread,
        {"type": "decision_report", "title": "Again", "message": "Again"},
    )
    assert again["type"] == "clarification"


def test_sync_decision_pending_from_trigger_state() -> None:
    thread: dict = {
        "decision_trigger_state": {
            "pending_confirmation": True,
            "pending_prompt": "Should I move cities?",
        },
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
    }
    pa = sync_decision_pending_from_trigger(thread, last_user_message="maybe")
    assert pa is not None
    assert pa["type"] == "decision_report"
    assert "move cities" in str(pa["payload"].get("decision_prompt") or "")


def test_clear_pending_clears_clarification_state() -> None:
    thread: dict = {}
    set_clarification_pending(
        thread,
        questions=[{"id": "x", "prompt": "Q?", "options": []}],
    )
    clear_pending_action(thread, resolution="skipped")
    assert "pending_action" not in thread
    st = thread.get("clarification_state") or {}
    assert "pending_questions" not in st


def test_derive_rehydrates_from_clarification_state() -> None:
    thread: dict = {
        "clarification_state": {
            "pending_questions": [{"id": "risk", "prompt": "Risk tolerance?", "options": []}],
            "pending_meta": {"domain": "career"},
            "pending_note": "",
        }
    }
    pa = derive_pending_action(thread)
    assert pa is not None
    assert pa["type"] == "clarification"
    assert pa["payload"]["questions"][0]["id"] == "risk"


def test_enrich_attaches_pending_for_api() -> None:
    thread: dict = {
        "messages": [{"role": "user", "content": "Help me choose"}],
        "decision_trigger_state": {
            "pending_confirmation": True,
            "pending_prompt": "Help me choose",
        },
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
    }
    enrich_thread_with_pending_action(thread)
    assert thread.get("pending_action", {}).get("type") == "decision_report"
