from foresight_x.schemas import MemoryFactCategory
from foresight_x.shadow.chat import (
    _ground_reply_with_memory_preferences,
    _heuristic_memory_facts_from_user_text,
)


def test_prefer_over_extracts_view_fact() -> None:
    out = _heuristic_memory_facts_from_user_text("I like LeBron over Kobe.")
    assert (MemoryFactCategory.VIEWS, "Prefers LeBron over Kobe") in out


def test_prefer_over_handles_prefer_verb() -> None:
    out = _heuristic_memory_facts_from_user_text("Honestly I prefer tea over coffee these days.")
    assert (MemoryFactCategory.VIEWS, "Prefers tea over coffee these days") in out


def test_no_match_returns_empty() -> None:
    out = _heuristic_memory_facts_from_user_text("School is heavy this week.")
    assert out == []


def test_identity_statement_is_captured() -> None:
    out = _heuristic_memory_facts_from_user_text("I am a junior at CMU.")
    assert (MemoryFactCategory.IDENTITY, "Identity: a junior at CMU") in out


def test_like_to_statement_is_captured_as_behavior() -> None:
    out = _heuristic_memory_facts_from_user_text("I like to jerk off.")
    assert (MemoryFactCategory.BEHAVIOR, "Behavior preference: likes to jerk off") in out


def test_ground_reply_prefers_explicit_memory_for_or_question() -> None:
    reply, used = _ground_reply_with_memory_preferences(
        "You're weighing two legends for different reasons.",
        user_text="Lebron or Kobe?",
        memory_fact_texts=["Prefers LeBron over Kobe"],
    )
    assert "prefer LeBron over Kobe" in reply
    assert "it's LeBron for you" in reply
    assert used == ["Prefers LeBron over Kobe"]


def test_ground_reply_no_override_when_no_direct_choice() -> None:
    reply, used = _ground_reply_with_memory_preferences(
        "You seem reflective today.",
        user_text="How's my week looking?",
        memory_fact_texts=["Prefers LeBron over Kobe"],
    )
    assert reply == "You seem reflective today."
    assert used == []
