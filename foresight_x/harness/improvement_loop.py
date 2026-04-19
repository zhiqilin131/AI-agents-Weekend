"""Minimal self-improvement loop: write outcomes back into memory."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.harness.trace import load_decision_trace
from foresight_x.retrieval.memory import UserMemory
from foresight_x.schemas import DecisionOutcome, DecisionTrace


def apply_outcome_to_memory(
    decision_id: str,
    outcome: DecisionOutcome,
    *,
    settings: Settings | None = None,
    user_memory: UserMemory | None = None,
    traces_dir: Path | None = None,
) -> DecisionTrace:
    """Load the trace and re-index it with the provided outcome."""
    s = settings or load_settings()
    trace = load_decision_trace(decision_id, settings=s, traces_dir=traces_dir)
    memory = user_memory or UserMemory(s.foresight_user_id, settings=s)
    memory.remove_by_decision_id(decision_id)
    memory.add_decision(trace, outcome=outcome)
    return trace
