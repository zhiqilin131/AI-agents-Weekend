from __future__ import annotations

from unittest.mock import MagicMock

from foresight_x.chat.thread_store import append_message, create_thread
from foresight_x.chat.thread_title import (
    apply_title_for_first_user_message,
    apply_title_from_wellbeing_intake,
    heuristic_thread_title,
    refine_thread_title_first_turn,
    resolve_thread_title,
    summarize_thread_title,
    title_needs_refresh,
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
    assert summarize_thread_title("Hi there", None) == "there"


def test_summarize_wellbeing_delegates_to_therapy_heuristic() -> None:
    title = summarize_thread_title("Anxiety or worry", None, slime_type="wellbeing")
    assert "Anxiety" in title or "worry" in title.lower()


def test_chat_placeholder_needs_refresh() -> None:
    thread = {"title": "Chat", "slime_type": "generalized", "messages": []}
    assert title_needs_refresh(thread)


def test_resolve_generalized_from_first_user_message() -> None:
    thread = {
        "title": "Chat",
        "slime_type": "generalized",
        "messages": [{"role": "user", "content": "Should I take the job offer in Seattle?"}],
    }
    title = resolve_thread_title(thread, llm=None)
    assert title != "Chat"
    assert "Seattle" in title or "job" in title.lower()


def test_resolve_rejects_assistant_opener_as_title() -> None:
    thread = {
        "title": "It sounds like you were referring",
        "slime_type": "generalized",
        "messages": [
            {"role": "user", "content": "I answered that a long time ago"},
            {
                "role": "assistant",
                "content": "It sounds like you were referring to something from earlier!",
            },
        ],
    }
    assert title_needs_refresh(thread)
    title = resolve_thread_title(thread, llm=None)
    assert "sounds like" not in title.lower()
    assert "answered" in title.lower() or "prior" in title.lower() or len(title) < 40


def test_apply_title_uses_first_user_not_assistant_param() -> None:
    t = create_thread(user_id="demo_user")
    t.setdefault("messages", []).append({"role": "user", "content": "Should I adopt a cat?"})
    applied = apply_title_for_first_user_message(
        t,
        "It sounds like you love pets",
        llm=None,
        slime_type="generalized",
    )
    assert applied is not None
    assert "sounds like" not in t["title"].lower()
    assert "cat" in t["title"].lower() or "adopt" in t["title"].lower()


def test_wellbeing_intake_does_not_set_sidebar_title() -> None:
    thread = {
        "title": "Therapy session",
        "slime_type": "wellbeing",
        "therapy_session": {"primary_concern": "Anxiety or worry", "session_goal": "Feel calmer"},
        "messages": [],
    }
    assert apply_title_from_wellbeing_intake(thread, llm=MagicMock()) is None
    assert thread["title"] == "Therapy session"


def test_verbatim_opener_detected_and_resummarized() -> None:
    first = "Hi, so my name is Tren Yang and I'm currently stressed about my roommate"
    thread = {
        "title": "Hi, so my name is Tren Yang and I'm currentl…",
        "slime_type": "wellbeing",
        "messages": [{"role": "user", "content": first}],
    }
    resolved = resolve_thread_title(thread, llm=None)
    assert "Hi, so my name" not in resolved
    assert "Tren Yang" not in resolved or "roommate" in resolved.lower() or "stressed" in resolved.lower()


def test_refine_thread_title_from_first_user_message() -> None:
    t = create_thread(user_id="demo_user", slime_type="wellbeing", title="Therapy session")
    append_message(t, role="user", content="I keep fighting with my partner about money", mode="normal")
    assert t["title"] != "Therapy session"
    stored = t["title"].lower()
    assert "partner" in stored or "money" in stored or "fighting" in stored
    # Second call is idempotent when title already summarized.
    assert refine_thread_title_first_turn(t, "I keep fighting with my partner about money", llm=None) is None


def test_list_resolution_does_not_downgrade_summarized_title_without_llm() -> None:
    first = "really stressed out right now, what should I do because my exam and sleep are falling apart"
    thread = {
        "title": "Stress and sleep before exam",
        "title_source": "first_user_turn",
        "slime_type": "wellbeing",
        "messages": [{"role": "user", "content": first}],
    }
    assert resolve_thread_title(thread, llm=None) == "Stress and sleep before exam"
