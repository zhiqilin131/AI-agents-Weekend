"""Tests for Slime Buddy memory subject separation (user vs companion)."""

from __future__ import annotations

from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact
from foresight_x.shadow.memory_subject_gate import (
    partition_slime_buddy_memory_candidates,
    user_explicitly_addresses_slime_companion,
)


def test_partition_drops_slime_name_as_user_identity() -> None:
    bad = ProfileMemoryFact(
        id="",
        category=MemoryFactCategory.IDENTITY,
        text="The user's name is Jarvis.",
        source="shadow",
        created_at="",
        subject_ref="user",
        predicate="name_is",
        object_value="Jarvis",
    )
    assistant = "I'm Jarvis, your little Slime Buddy!"
    user_msg = "I am a student studying at Carnegie Mellon University."
    out = partition_slime_buddy_memory_candidates(
        [bad],
        last_user_text=user_msg,
        slime_display_name="Jarvis",
        assistant_reply=assistant,
    )
    assert out == []


def test_partition_keeps_user_school_fact() -> None:
    ok = ProfileMemoryFact(
        id="",
        category=MemoryFactCategory.IDENTITY,
        text="User studies at Carnegie Mellon University.",
        source="shadow",
        created_at="",
        subject_ref="user",
        evidence="Carnegie Mellon",
    )
    assistant = "I'm Jarvis, your little Slime Buddy!"
    user_msg = "I am a student studying at Carnegie Mellon University."
    out = partition_slime_buddy_memory_candidates(
        [ok],
        last_user_text=user_msg,
        slime_display_name="Jarvis",
        assistant_reply=assistant,
    )
    assert len(out) == 1


def test_partition_slime_row_requires_explicit_address() -> None:
    slime_row = ProfileMemoryFact(
        id="",
        category=MemoryFactCategory.OTHER,
        text="slime_companion favorite_color blue",
        source="shadow",
        created_at="",
        subject_ref="slime_companion",
    )
    out_no = partition_slime_buddy_memory_candidates(
        [slime_row],
        last_user_text="I work remotely Tuesdays.",
        slime_display_name="Blob",
        assistant_reply="Okay!",
    )
    assert out_no == []

    out_yes = partition_slime_buddy_memory_candidates(
        [slime_row],
        last_user_text="Hey Blob, remember your favorite color is blue.",
        slime_display_name="Blob",
        assistant_reply="Got it!",
    )
    assert len(out_yes) == 1
    assert out_yes[0].qualifiers.get("memory_owner") == "slime_companion"


def test_user_explicitly_addresses_by_name() -> None:
    assert user_explicitly_addresses_slime_companion("Jarvis, what can you do?", "Jarvis") is True
    assert user_explicitly_addresses_slime_companion("I'm Jarvis too", "Jarvis") is False
