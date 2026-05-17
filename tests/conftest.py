"""Shared fixtures."""

from __future__ import annotations

import pytest

from foresight_x.resilience.runtime import reset_resilience_runtime_state


@pytest.fixture(autouse=True)
def _isolated_resilience_state() -> None:
    """Prevent circuit-breaker / degradation events from leaking across tests."""
    reset_resilience_runtime_state()
    yield
    reset_resilience_runtime_state()


@pytest.fixture
def sample_user_state_dict() -> dict:
    return {
        "raw_input": "Offer from Company X, deadline Friday.",
        "goals": ["maximize career growth", "minimize regret"],
        "time_pressure": "high",
        "stress_level": 7,
        "workload": 6,
        "current_behavior": "rushed",
        "decision_type": "career",
        "reversibility": "partial",
        "deadline_hint": "Friday 5pm",
    }
