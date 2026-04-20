"""RRF + recent_events fusion helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.retrieval.recent_events_fusion import (
    build_fused_recent_facts,
    reciprocal_rank_fusion,
)
from foresight_x.schemas import MemoryBundle, PastDecision, UserState
from foresight_x.schemas import Reversibility, TimePressure


def test_reciprocal_rank_fusion_orders_by_consensus() -> None:
    """Document with strong ranks in multiple lists should score highly."""
    fused = reciprocal_rank_fusion(
        [
            ["doc_a", "doc_b"],
            ["doc_b", "doc_a"],
            ["doc_a"],
        ]
    )
    ids = [x[0] for x in fused]
    assert ids[0] == "doc_a"


def test_build_fused_recent_facts_prefers_memory_and_outcomes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FORESIGHT_USER_ID", "u1")
    s = Settings()

    traces_dir = tmp_path / "traces"
    traces_dir.mkdir()
    trace_body = {
        "decision_id": "past-1",
        "timestamp": "2026-02-01T12:00:00Z",
        "user_state": {
            "raw_input": "Career pivot to product management?",
            "goals": ["growth"],
            "time_pressure": "low",
            "stress_level": 3,
            "workload": 4,
            "current_behavior": "curious",
            "decision_type": "career",
            "reversibility": "partial",
        },
        "memory": {"similar_past_decisions": [], "behavioral_patterns": [], "prior_outcomes_summary": ""},
        "evidence": {"facts": [], "base_rates": [], "recent_events": []},
        "rationality": {
            "is_rational_state": True,
            "detected_biases": [],
            "confidence": 0.8,
            "recommended_slowdowns": [],
        },
        "options": [
            {
                "option_id": "o1",
                "name": "Stay IC",
                "description": "d",
                "key_assumptions": [],
                "cost_of_reversal": "low",
            }
        ],
        "futures": [],
        "evaluations": [],
        "recommendation": {
            "chosen_option_id": "o1",
            "reasoning": "r",
            "next_actions": [],
            "reassessment_triggers": [],
        },
        "reflection": {
            "possible_errors": [],
            "uncertainty_sources": [],
            "model_limitations": [],
            "information_gaps": [],
            "self_improvement_signal": "",
        },
    }
    traces_dir.joinpath("past-1.json").write_text(json.dumps(trace_body), encoding="utf-8")

    outcomes_dir = tmp_path / "outcomes"
    outcomes_dir.mkdir()
    outcomes_dir.joinpath("past-1.json").write_text(
        json.dumps(
            {
                "decision_id": "past-1",
                "user_took_recommended_action": True,
                "actual_outcome": "Promoted after 6 months.",
                "user_reported_quality": 5,
                "reversed_later": False,
                "timestamp": "2026-06-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )

    shadow_dir = tmp_path / "shadow_self"
    shadow_dir.mkdir()
    shadow_dir.joinpath("u1.json").write_text(
        json.dumps(
            {
                "user_id": "u1",
                "observations": [
                    "Generic line one about feelings.",
                    "Career anxiety when choosing between IC and manager track.",
                ],
                "updated_at": "x",
                "turn_count": 2,
            }
        ),
        encoding="utf-8",
    )

    us = UserState(
        raw_input="Should I take a PM role or stay IC?",
        goals=["impact"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="thoughtful",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    mem = MemoryBundle(
        similar_past_decisions=[
            PastDecision(
                decision_id="past-1",
                situation_summary="x",
                chosen_option="y",
                outcome="z",
                outcome_quality=5,
                timestamp="2026-01-01T00:00:00Z",
            )
        ],
        behavioral_patterns=[],
        prior_outcomes_summary="",
    )
    facts = build_fused_recent_facts(s, us, mem, exclude_decision_id="current-run")
    texts = [f.text for f in facts]
    assert any("past-1" in t and "Decision history" in t for t in texts)
    assert any("Recorded outcome" in t for t in texts)
    assert any("Shadow" in t for t in texts)


def test_build_fused_recent_facts_reranks_by_query_overlap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FORESIGHT_USER_ID", "u1")
    s = Settings()

    traces_dir = tmp_path / "traces"
    traces_dir.mkdir()
    for i in range(10):
        did = f"gen-{i}"
        trace_body = {
            "decision_id": did,
            "timestamp": f"2026-02-01T12:{i:02d}:00Z",
            "user_state": {
                "raw_input": f"Generic planning decision #{i}",
                "goals": ["plan"],
                "time_pressure": "low",
                "stress_level": 3,
                "workload": 4,
                "current_behavior": "steady",
                "decision_type": "general",
                "reversibility": "partial",
            },
            "memory": {"similar_past_decisions": [], "behavioral_patterns": [], "prior_outcomes_summary": ""},
            "evidence": {"facts": [], "base_rates": [], "recent_events": []},
            "rationality": {
                "is_rational_state": True,
                "detected_biases": [],
                "confidence": 0.8,
                "recommended_slowdowns": [],
            },
            "options": [
                {
                    "option_id": "o1",
                    "name": "Option",
                    "description": "d",
                    "key_assumptions": [],
                    "cost_of_reversal": "low",
                }
            ],
            "futures": [],
            "evaluations": [],
            "recommendation": {
                "chosen_option_id": "o1",
                "reasoning": "r",
                "next_actions": [],
                "reassessment_triggers": [],
            },
            "reflection": {
                "possible_errors": [],
                "uncertainty_sources": [],
                "model_limitations": [],
                "information_gaps": [],
                "self_improvement_signal": "",
            },
        }
        traces_dir.joinpath(f"{did}.json").write_text(json.dumps(trace_body), encoding="utf-8")

    # Older timestamp but highly query-relevant.
    trace_body = {
        "decision_id": "amy-david",
        "timestamp": "2026-01-01T00:00:00Z",
        "user_state": {
            "raw_input": "David asking Amy about Friday CSA officer meeting attendance",
            "goals": ["communication"],
            "time_pressure": "medium",
            "stress_level": 4,
            "workload": 5,
            "current_behavior": "careful",
            "decision_type": "personal",
            "reversibility": "partial",
        },
        "memory": {"similar_past_decisions": [], "behavioral_patterns": [], "prior_outcomes_summary": ""},
        "evidence": {"facts": [], "base_rates": [], "recent_events": []},
        "rationality": {"is_rational_state": True, "detected_biases": [], "confidence": 0.8, "recommended_slowdowns": []},
        "options": [{"option_id": "o1", "name": "Message her", "description": "d", "key_assumptions": [], "cost_of_reversal": "low"}],
        "futures": [],
        "evaluations": [],
        "recommendation": {"chosen_option_id": "o1", "reasoning": "r", "next_actions": [], "reassessment_triggers": []},
        "reflection": {"possible_errors": [], "uncertainty_sources": [], "model_limitations": [], "information_gaps": [], "self_improvement_signal": ""},
    }
    traces_dir.joinpath("amy-david.json").write_text(json.dumps(trace_body), encoding="utf-8")

    us = UserState(
        raw_input="Should David message Amy about Friday night CSA meeting attendance?",
        goals=["clarity"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="thoughtful",
        decision_type="personal",
        reversibility=Reversibility.PARTIAL,
    )
    mem = MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary="")

    facts = build_fused_recent_facts(s, us, mem)
    texts = [f.text for f in facts]
    assert any("amy-david" in t for t in texts)
