"""Table-driven tests for ``refine_memory_category`` (other → identity/views/behavior)."""

from __future__ import annotations

import pytest

from foresight_x.profile.memory_classification import refine_memory_category
from foresight_x.profile.memory_classification_rules import refine_other_with_rules
from foresight_x.schemas import MemoryFactCategory


@pytest.mark.parametrize(
    ("text", "evidence", "predicate", "expected"),
    [
        (
            "User likes FC Barcelona.",
            "I like FC Barcelona",
            "",
            MemoryFactCategory.VIEWS,
        ),
        (
            "User supports Liverpool.",
            "I support Liverpool FC",
            "",
            MemoryFactCategory.VIEWS,
        ),
        (
            "User likes to eat burgers.",
            "I like to eat burgers",
            "",
            MemoryFactCategory.BEHAVIOR,
        ),
        (
            "User has 2 roommates.",
            "I have 2 room mates Bob and Andrew",
            "",
            MemoryFactCategory.IDENTITY,
        ),
        (
            "One roommate is named Jimmy.",
            "my roommates are Andrew and Jimmy",
            "",
            MemoryFactCategory.IDENTITY,
        ),
        (
            "User · has_roommate · Jimmy",
            "my roommates are Andrew and Jimmy",
            "has_roommate",
            MemoryFactCategory.IDENTITY,
        ),
        (
            "Random logistics note.",
            "maybe tomorrow",
            "",
            MemoryFactCategory.OTHER,
        ),
    ],
)
def test_refine_other_bucket(text: str, evidence: str, predicate: str, expected: MemoryFactCategory) -> None:
    assert (
        refine_memory_category(
            MemoryFactCategory.OTHER,
            text=text,
            evidence=evidence,
            predicate=predicate,
            subject_ref="user",
        )
        == expected
    )


def test_non_other_unchanged() -> None:
    assert (
        refine_memory_category(
            MemoryFactCategory.IDENTITY,
            text="User likes FC Barcelona.",
            evidence="I like FC Barcelona",
            predicate="",
            subject_ref="user",
        )
        == MemoryFactCategory.IDENTITY
    )


def test_views_not_triggered_by_food_like_alone() -> None:
    """'I like' + food should stay behavior, not views."""
    assert (
        refine_memory_category(
            MemoryFactCategory.OTHER,
            text="User likes pizza.",
            evidence="I love pizza night",
            predicate="",
            subject_ref="user",
        )
        == MemoryFactCategory.BEHAVIOR
    )


@pytest.mark.parametrize(
    ("text", "evidence", "predicate", "expected"),
    [
        (
            "Peanut allergy",
            "I'm allergic to peanuts",
            "",
            MemoryFactCategory.CONSTRAINTS,
        ),
        (
            "Rent stress",
            "I can't afford more than $800/month",
            "",
            MemoryFactCategory.CONSTRAINTS,
        ),
        (
            "Bar exam",
            "I want to pass the bar next year",
            "",
            MemoryFactCategory.GOALS,
        ),
        (
            "Triple",
            "Alice is a cofounder",
            "co_founder_with",
            MemoryFactCategory.IDENTITY,
        ),
        (
            "Savings",
            "",
            "savings_goal",
            MemoryFactCategory.GOALS,
        ),
    ],
)
def test_rule_fallback_tiers(text: str, evidence: str, predicate: str, expected: MemoryFactCategory) -> None:
    assert (
        refine_other_with_rules(
            text=text,
            evidence=evidence,
            predicate=predicate,
            subject_ref="user",
        )
        == expected
    )
