"""Trace list/delete helpers."""

from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.harness.trace_index import delete_trace, list_traces
from foresight_x.schemas import DecisionTrace, Reversibility, TimePressure, UserState
from foresight_x.harness.trace import save_decision_trace


@pytest.fixture
def iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    return Settings()


def test_list_and_delete_trace_and_outcome(iso: Settings) -> None:
    us = UserState(
        raw_input="hello world " * 5,
        goals=["g"],
        time_pressure=TimePressure.LOW,
        stress_level=1,
        workload=1,
        current_behavior="c",
        decision_type="general",
        reversibility=Reversibility.PARTIAL,
    )
    trace = DecisionTrace.model_validate(
        {
            "decision_id": "tid-1",
            "timestamp": "2026-01-01T00:00:00Z",
            "user_state": us.model_dump(mode="json"),
            "memory": {
                "similar_past_decisions": [],
                "behavioral_patterns": [],
                "prior_outcomes_summary": "",
            },
            "evidence": {"facts": [], "base_rates": [], "recent_events": []},
            "rationality": {
                "is_rational_state": True,
                "detected_biases": [],
                "confidence": 0.5,
                "recommended_slowdowns": [],
            },
            "options": [],
            "futures": [],
            "evaluations": [],
            "recommendation": {
                "chosen_option_id": "x",
                "reasoning": "r",
                "next_actions": [],
                "reassessment_triggers": [],
            },
            "reflection": {
                "possible_errors": [],
                "uncertainty_sources": [],
                "model_limitations": [],
                "information_gaps": [],
                "self_improvement_signal": "s",
            },
        }
    )
    save_decision_trace(trace, settings=iso)
    (iso.outcomes_dir / "tid-1.json").parent.mkdir(parents=True, exist_ok=True)
    (iso.outcomes_dir / "tid-1.json").write_text('{"decision_id":"tid-1"}', encoding="utf-8")

    rows = list_traces(settings=iso)
    assert len(rows) == 1
    assert rows[0].decision_id == "tid-1"
    assert "hello" in rows[0].preview
    assert rows[0].has_outcome is True
    assert rows[0].has_commit is False

    td, od, cd = delete_trace("tid-1", settings=iso)
    assert td is True
    assert od is True
    assert cd is False
    assert not (iso.traces_dir / "tid-1.json").exists()
    assert not (iso.outcomes_dir / "tid-1.json").exists()
    assert list_traces(settings=iso) == []
