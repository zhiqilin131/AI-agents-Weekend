"""Profile + vector query strings must stay identical across memory, world, and evidence."""

from __future__ import annotations

from foresight_x.retrieval.memory_query import build_unified_vector_query
from foresight_x.retrieval.query_text import (
    profile_fact_line_for_recent_events,
    profile_snippet_for_retrieval,
)
from foresight_x.schemas import Reversibility, TimePressure, UserState


def test_profile_snippet_is_exact_substring_of_unified_vector_query() -> None:
    us = UserState(
        raw_input="Negotiate offer deadline or sign now?",
        goals=["information"],
        time_pressure=TimePressure.HIGH,
        stress_level=6,
        workload=5,
        current_behavior="focused",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
        profile_user_priorities=["long-term fit"],
        profile_about_me="Prefers small teams.",
        profile_constraints=["visa"],
        profile_values=["honesty"],
    )
    snip = profile_snippet_for_retrieval(us)
    q = build_unified_vector_query(us)
    assert snip in q
    assert "user_stated_priorities" in q
    assert "about_me" in q


def test_profile_fact_line_is_prefix_plus_identical_snippet() -> None:
    us = UserState(
        raw_input="x",
        goals=["g"],
        time_pressure=TimePressure.LOW,
        stress_level=1,
        workload=1,
        current_behavior="c",
        decision_type="general",
        reversibility=Reversibility.REVERSIBLE,
        profile_inferred_priorities=["risk-aware"],
    )
    snip = profile_snippet_for_retrieval(us).strip()
    line = profile_fact_line_for_recent_events(us)
    assert line is not None
    assert line == f"Profile (retrieval snippet): {snip}"
