"""Tests for Slime memory evidence chip builders."""

from __future__ import annotations

from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact
from foresight_x.voice.memory_evidence import (
    build_turn_memory_evidence,
    evidence_items_from_profile_facts,
    evidence_items_from_text_snippets,
    merge_evidence_items,
)


def test_evidence_from_profile_facts() -> None:
    facts = [
        ProfileMemoryFact(
            id="f1",
            text="Rose is my girlfriend and we plan October visits.",
            category=MemoryFactCategory.IDENTITY,
            importance=0.9,
        )
    ]
    items = evidence_items_from_profile_facts(facts)
    assert len(items) == 1
    assert items[0]["type"] == "profile"
    assert "Rose" in (items[0].get("fullText") or "")


def test_merge_dedupes_by_text() -> None:
    a = evidence_items_from_text_snippets(["Same fact here."])
    b = evidence_items_from_text_snippets(["Same fact here."])
    merged = merge_evidence_items(a, b)
    assert len(merged) == 1


def test_build_turn_memory_evidence_combines_sources() -> None:
    facts = [
        ProfileMemoryFact(
            id="f2",
            text="Internship at Acme starts in June.",
            category=MemoryFactCategory.GOALS,
        )
    ]
    items = build_turn_memory_evidence(
        retrieved_facts=facts,
        used_text_facts=["Internship at Acme starts in June.", "Extra grounding line."],
    )
    assert len(items) >= 2
    texts = " ".join(str(i.get("fullText") or "") for i in items)
    assert "Internship" in texts
    assert "Extra grounding" in texts
