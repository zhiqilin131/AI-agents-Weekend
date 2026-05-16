"""Memory-first clarification gating."""

from __future__ import annotations

from foresight_x.perception.personalized_clarify import (
    gather_clarify_memory_lines,
    memory_and_message_sufficient_for_reply,
)
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile


def test_no_memory_insufficient_for_vague_decide() -> None:
    prof = UserProfile()
    ok, reason = memory_and_message_sufficient_for_reply("Help me decide", prof)
    assert ok is False
    assert reason == "no_relevant_memory"


def test_rich_memory_can_skip_clarification() -> None:
    prof = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="m1",
                text="Prefers learning upside over prestige for summer internships",
                category=MemoryFactCategory.GOALS,
                confidence=0.9,
                importance=0.8,
            ),
            ProfileMemoryFact(
                id="m2",
                text="Risk tolerance moderate; wants option with better mentorship",
                category=MemoryFactCategory.GOALS,
                confidence=0.85,
                importance=0.7,
            ),
            ProfileMemoryFact(
                id="m3",
                text="Considering Google offer versus staying at current startup",
                category=MemoryFactCategory.OTHER,
                confidence=0.8,
                importance=0.75,
            ),
            ProfileMemoryFact(
                id="m4",
                text="Workload cap roughly 50 hours per week",
                category=MemoryFactCategory.CONSTRAINTS,
                confidence=0.9,
                importance=0.6,
            ),
            ProfileMemoryFact(
                id="m5",
                text="Location flexible within Bay Area",
                category=MemoryFactCategory.CONSTRAINTS,
                confidence=0.85,
                importance=0.5,
            ),
        ]
    )
    msg = "Should I take the Google offer or stay at my startup for learning?"
    lines = gather_clarify_memory_lines(msg, prof)
    assert len(lines) >= 3
    ok, _ = memory_and_message_sufficient_for_reply(msg, prof)
    assert ok is True
