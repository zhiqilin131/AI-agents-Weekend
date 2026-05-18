"""Therapy / wellbeing thread titles use summarized labels, not raw first lines."""

from __future__ import annotations

from unittest.mock import MagicMock

from foresight_x.chat.thread_store import create_thread
from foresight_x.chat.thread_title import (
    apply_title_for_first_user_message,
    apply_title_from_wellbeing_intake,
    resolve_wellbeing_thread_title,
    summarize_therapy_thread_title,
    title_needs_wellbeing_refresh,
)


def test_therapy_title_from_intake_not_first_message() -> None:
    thread = create_thread(user_id="u1", title="Therapy session", slime_type="wellbeing")
    thread["therapy_session"] = {
        "intake_complete": True,
        "primary_concern": "Anxiety or worry",
        "session_goal": "Feel steadier before exams",
    }
    applied = apply_title_from_wellbeing_intake(thread, llm=None)
    assert applied is None
    assert thread["title"] == "Therapy session"


def test_long_first_line_triggers_refresh() -> None:
    long_msg = (
        "Hi, I'm really stressed out right now, what should I do about everything happening at work"
    )
    thread = {
        "slime_type": "wellbeing",
        "title": long_msg[:56] + "…",
        "messages": [{"role": "user", "content": long_msg}],
        "therapy_session": {"primary_concern": "Stress or overwhelm", "session_goal": "Calm down"},
    }
    assert title_needs_wellbeing_refresh(thread)
    resolved = resolve_wellbeing_thread_title(thread, llm=None)
    assert len(resolved) < len(long_msg)
    assert "stress" in resolved.lower() or "Stress" in resolved


def test_llm_therapy_title_replaces_heuristic(monkeypatch) -> None:
    from foresight_x.chat import thread_title as mod

    monkeypatch.setattr(
        mod,
        "structured_predict",
        lambda llm, cls, prompt: mod._ThreadTitleOut(title="Breakup grief support"),
    )
    thread = create_thread(user_id="u2", title="Therapy session", slime_type="wellbeing")
    content = "I just broke up with my girlfriend and I don't know what to do anymore"
    thread.setdefault("messages", []).append({"role": "user", "content": content})
    applied = apply_title_for_first_user_message(
        thread, content, llm=MagicMock(), slime_type="wellbeing"
    )
    assert applied == "Breakup grief support"
    assert thread["title"] == "Breakup grief support"


def test_summarize_therapy_without_llm_uses_heuristic() -> None:
    title = summarize_therapy_thread_title("Stress or overwhelm", None)
    assert "Stress" in title or "overwhelm" in title


def test_first_user_message_title_overrides_intake_category() -> None:
    long_msg = "I keep waking at 3am worrying about my thesis deadline next week"
    thread = {
        "slime_type": "wellbeing",
        "title": "Anxiety or worry",
        "messages": [{"role": "user", "content": long_msg}],
        "therapy_session": {
            "primary_concern": "Anxiety or worry",
            "session_goal": "Feel steadier before exams",
        },
    }
    assert title_needs_wellbeing_refresh(thread)
    resolved = resolve_wellbeing_thread_title(thread, llm=None)
    assert "Anxiety or worry" != resolved
    assert "thesis" in resolved.lower() or "waking" in resolved.lower() or len(resolved) < len(long_msg)


def test_intake_title_skipped_after_first_user_message() -> None:
    thread = create_thread(user_id="u3", title="Therapy session", slime_type="wellbeing")
    thread["messages"] = [{"role": "user", "content": "My partner and I argued again last night"}]
    thread["therapy_session"] = {
        "primary_concern": "Relationship conflict",
        "session_goal": "Communicate better",
    }
    assert apply_title_from_wellbeing_intake(thread, llm=None) is None
