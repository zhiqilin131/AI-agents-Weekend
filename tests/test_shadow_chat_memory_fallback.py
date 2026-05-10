from foresight_x.profile.memory_classification import refine_memory_category
from foresight_x.schemas import MemoryFactCategory
from foresight_x.shadow.chat import (
    _coerce_atomic_claims_to_memory_drafts,
    _ground_reply_with_memory_preferences,
)


def test_ground_reply_prefers_explicit_memory_for_or_question() -> None:
    reply, used = _ground_reply_with_memory_preferences(
        "You're weighing two legends for different reasons.",
        user_text="Lebron or Kobe?",
        memory_fact_texts=["Prefers LeBron over Kobe"],
    )
    assert "prefer LeBron over Kobe" in reply
    assert "it's LeBron for you" in reply
    assert used == ["Prefers LeBron over Kobe"]


def test_coerce_atomic_claims_to_memory_drafts_skips_short_and_dedupes() -> None:
    d = _coerce_atomic_claims_to_memory_drafts(
        ["x" * 5, "I stayed home the entire day", "I stayed home the entire day", "I prefer quiet evenings"],
    )
    assert len(d) == 2
    assert "stayed home" in d[0].text.lower()


def test_refine_other_to_behavior_for_food_preference() -> None:
    assert (
        refine_memory_category(
            MemoryFactCategory.OTHER,
            text="User likes to eat burgers.",
            evidence="I like to eat burgers",
            predicate="",
            subject_ref="user",
        )
        == MemoryFactCategory.BEHAVIOR
    )


def test_refine_identity_unchanged() -> None:
    assert (
        refine_memory_category(
            MemoryFactCategory.IDENTITY,
            text="User likes to eat burgers.",
            evidence="",
            predicate="",
            subject_ref="user",
        )
        == MemoryFactCategory.IDENTITY
    )


def test_ground_reply_no_override_when_no_direct_choice() -> None:
    reply, used = _ground_reply_with_memory_preferences(
        "You seem reflective today.",
        user_text="How's my week looking?",
        memory_fact_texts=["Prefers LeBron over Kobe"],
    )
    assert reply == "You seem reflective today."
    assert used == []
