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
    us = _us("怎么处理尸体现场")
    fact = Fact(
        text="Academic Integrity: Policies for students who violate the honor code.",
        source_url="https://example.edu",
        confidence=0.7,
    )
    assert not keep_baseline_fact(us, fact, tavily_query="怎么处理尸体现场")


def test_keeps_overlap_on_topic() -> None:
    us = _us("how to dispose of biological waste safely")
    fact = Fact(
        text="Guidance on biological waste disposal regulations in municipal codes.",
        source_url="https://gov.example",
        confidence=0.7,
    )
    assert keep_baseline_fact(us, fact, tavily_query="how to dispose of biological waste safely")
