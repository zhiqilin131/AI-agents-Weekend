from __future__ import annotations

from unittest.mock import MagicMock

from foresight_x.chat.thread_store import append_message, create_thread
from foresight_x.chat.thread_title import (
    apply_title_for_first_user_message,
    heuristic_thread_title,
    summarize_thread_title,
)


def test_heuristic_strips_decision_starter_prefix() -> None:
    raw = "Help me decide something concrete: Should I sleep with my girlfriend tonight?"
    title = heuristic_thread_title(raw)
    assert title.startswith("Should I sleep")
    assert "Help me decide" not in title


def test_apply_title_only_on_first_user_turn() -> None:
    t = create_thread(user_id="demo_user")
    append_message(t, role="user", content="Should I go to the gym?", mode="normal")
    first = t["title"]
    assert first != "New chat"
    append_message(t, role="user", content="Another question", mode="normal")
    assert t["title"] == first


def test_llm_title_replaces_heuristic_on_first_turn(monkeypatch) -> None:
    from foresight_x.chat import thread_title as mod

    monkeypatch.setattr(
        mod,
        "structured_predict",
        lambda llm, cls, prompt: mod._ThreadTitleOut(title="Gym vs rest day"),
    )
    t = create_thread(user_id="demo_user")
    append_message(t, role="user", content="Help me decide: gym or rest?", mode="normal")
    assert "gym" in t["title"].lower() or "rest" in t["title"].lower()
    updated = apply_title_for_first_user_message(t, "Help me decide: gym or rest?", llm=MagicMock())
    assert updated == "Gym vs rest day"
    assert t["title"] == "Gym vs rest day"


def test_summarize_without_llm_uses_heuristic() -> None:
    assert summarize_thread_title("Hi there", None) == "Hi there"
