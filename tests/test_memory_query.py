"""Tests for structured memory retrieval query text."""

from __future__ import annotations

from foresight_x.retrieval.memory_query import build_memory_retrieval_query
from foresight_x.schemas import Reversibility, TimePressure, UserState


def test_build_memory_retrieval_query_has_labeled_sections() -> None:
    state = UserState(
        raw_input="Should I take offer A or wait for B?",
        goals=["long-term fit", "learning"],
        time_pressure=TimePressure.HIGH,
        stress_level=7,
        workload=6,
        current_behavior="anxious comparison",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
        deadline_hint="Friday 5pm",
        profile_user_priorities=["stability"],
        profile_inferred_priorities=["risk aversion"],
        profile_about_me="CS student",
        profile_constraints=["visa"],
        profile_values=["honesty"],
    )
    q = build_memory_retrieval_query(state)
    assert "decision_domain career" in q
    assert "goals long-term fit learning" in q
    assert "current_behavior anxious comparison" in q
    assert "time_pressure high" in q.lower()
    assert "stress_level 7" in q
    assert "workload 6" in q
    assert "reversibility partial" in q.lower()
    assert "deadline_hint" in q
    assert "Friday" in q
    assert "user_stated_priorities stability" in q
    assert "situation" in q
    assert "offer A" in q


def test_build_memory_retrieval_query_omits_empty_optional_bits() -> None:
    state = UserState(
        raw_input="x",
        goals=[],
        time_pressure=TimePressure.LOW,
        stress_level=1,
        workload=1,
        current_behavior="",
        decision_type="general",
        reversibility=Reversibility.REVERSIBLE,
        deadline_hint=None,
    )
    q = build_memory_retrieval_query(state)
    assert "decision_domain general" in q
    assert "deadline_hint" not in q
    assert "goals " not in q
