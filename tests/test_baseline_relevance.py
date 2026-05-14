"""Baseline relevance filtering."""

from __future__ import annotations

from foresight_x.retrieval.baseline_relevance import keep_baseline_fact
from foresight_x.schemas import Fact, Reversibility, TimePressure, UserState


def _us(raw: str) -> UserState:
    return UserState(
        raw_input=raw,
        goals=["g"],
        time_pressure=TimePressure.LOW,
        stress_level=3,
        workload=3,
        current_behavior="c",
        decision_type="general",
        reversibility=Reversibility.PARTIAL,
    )


def test_drops_academic_integrity_when_question_not_academic() -> None:
    q = "how to handle a crime scene body disposal"
    us = _us(q)
    fact = Fact(
        text="Academic Integrity: Policies for students who violate the honor code.",
        source_url="https://example.edu",
        confidence=0.7,
    )
    assert not keep_baseline_fact(us, fact, tavily_query=q)


def test_keeps_overlap_on_topic() -> None:
    us = _us("how to dispose of biological waste safely")
    fact = Fact(
        text="Guidance on biological waste disposal regulations in municipal codes.",
        source_url="https://gov.example",
        confidence=0.7,
    )
    assert keep_baseline_fact(us, fact, tavily_query="how to dispose of biological waste safely")


def test_rejects_single_token_overlap_that_is_not_topical() -> None:
    us = _us("Should I transfer to CMU for CS this fall?")
    fact = Fact(
        text="Football transfer rumor tracker and fantasy league updates.",
        source_url="https://sports.example",
        confidence=0.7,
    )
    assert not keep_baseline_fact(us, fact, tavily_query="Should I transfer to CMU for CS this fall?")
