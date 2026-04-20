"""Structured embedding query for **memory and world** Chroma retrieval.

The same string is used for ``UserMemory`` and ``WorldKnowledge`` vector search.
Profile text is included only via
:func:`foresight_x.retrieval.query_text.profile_snippet_for_retrieval`.
"""

from __future__ import annotations

from foresight_x.retrieval.query_text import SITUATION_QUERY_MAX_CHARS, profile_snippet_for_retrieval
from foresight_x.schemas import UserState


def build_unified_vector_query(user_state: UserState) -> str:
    """Single query string for both memory and world vector indices."""
    parts: list[str] = []
    dt = (user_state.decision_type or "").strip()
    if dt:
        parts.append(f"decision_domain {dt}")
    if user_state.goals:
        parts.append("goals " + " ".join(user_state.goals))
    cb = (user_state.current_behavior or "").strip()
    if cb:
        parts.append(f"current_behavior {cb}")
    parts.append(f"time_pressure {user_state.time_pressure.value}")
    parts.append(f"stress_level {user_state.stress_level}")
    parts.append(f"workload {user_state.workload}")
    parts.append(f"reversibility {user_state.reversibility.value}")
    dh = (user_state.deadline_hint or "").strip()
    if dh:
        parts.append(f"deadline_hint {dh[:500]}")
    profile = profile_snippet_for_retrieval(user_state)
    if profile:
        parts.append(profile)
    raw = (user_state.raw_input or "")[: SITUATION_QUERY_MAX_CHARS]
    if raw.strip():
        parts.append(f"situation {raw.strip()}")
    return " ".join(parts)


def build_memory_retrieval_query(user_state: UserState) -> str:
    """Alias for :func:`build_unified_vector_query` (past-decision index)."""
    return build_unified_vector_query(user_state)
