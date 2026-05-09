"""Profile memory facts gain usable created_at for diary-by-day."""

from __future__ import annotations

from foresight_x.profile.memory_timestamp_backfill import backfill_memory_fact_timestamps
from foresight_x.schemas import ProfileMemoryFact, UserProfile


def test_backfill_sets_created_at_when_missing() -> None:
    p = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="fact-a",
                text="Legacy row",
                source="shadow",
                created_at="",
            )
        ]
    )
    fixed, changed = backfill_memory_fact_timestamps(p, profile_path_fs=None)
    assert changed is True
    assert fixed.memory_facts[0].created_at
    assert fixed.memory_facts[0].qualifiers.get("timestamp_inferred") is True


def test_backfill_uses_source_timestamp_qualifier() -> None:
    p = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="fact-b",
                text="Imported",
                source="import",
                created_at="",
                qualifiers={"source_timestamp": "2026-03-15T08:00:00Z"},
            )
        ]
    )
    fixed, changed = backfill_memory_fact_timestamps(p, profile_path_fs=None)
    assert changed is True
    assert fixed.memory_facts[0].created_at.startswith("2026-03-15")


def test_backfill_respects_existing_created_at() -> None:
    p = UserProfile(
        memory_facts=[
            ProfileMemoryFact(
                id="fact-c",
                text="Ok",
                source="user",
                created_at="2026-01-01T00:00:00Z",
            )
        ]
    )
    fixed, changed = backfill_memory_fact_timestamps(p, profile_path_fs=None)
    assert changed is False
    assert fixed.memory_facts[0].created_at.startswith("2026-01-01")
