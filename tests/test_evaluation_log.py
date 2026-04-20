"""Evaluation log row shape (no HTTP, no OpenAI)."""

from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.harness.evaluation_log import append_evaluation_log, build_evaluation_record
from foresight_x.schemas import (
    DecisionCommit,
    DecisionOutcome,
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    RationalityReport,
    Recommendation,
    Reflection,
    SimulatedFuture,
    UserState,
    Reversibility,
    TimePressure,
)


def _minimal_trace() -> DecisionTrace:
    us = UserState(
        raw_input="test situation",
        goals=["g"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=4,
        current_behavior="c",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    opt_a = Option(
        option_id="a",
        name="A",
        description="d",
        key_assumptions=["k"],
        cost_of_reversal="low",
    )
    opt_b = Option(
        option_id="b",
        name="B",
        description="d2",
        key_assumptions=["k"],
        cost_of_reversal="low",
    )
    ev_a = OptionEvaluation(
        option_id="a",
        expected_value_score=8.0,
        risk_score=3.0,
        regret_score=2.0,
        uncertainty_score=4.0,
        goal_alignment_score=7.0,
        rationale="r",
    )
    ev_b = OptionEvaluation(
        option_id="b",
        expected_value_score=6.0,
        risk_score=5.0,
        regret_score=4.0,
        uncertainty_score=5.0,
        goal_alignment_score=6.0,
        rationale="r2",
    )
    return DecisionTrace(
        decision_id="d-1",
        timestamp="2026-01-01T00:00:00Z",
        user_state=us,
        memory=MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary=""),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.8,
            recommended_slowdowns=[],
        ),
        options=[opt_a, opt_b],
        futures=[
            SimulatedFuture(option_id="a", time_horizon="3mo", scenarios=[]),
        ],
        evaluations=[ev_a, ev_b],
        recommendation=Recommendation(
            chosen_option_id="a",
            reasoning="pick a",
            next_actions=[],
            reassessment_triggers=[],
        ),
        reflection=Reflection(
            possible_errors=[],
            uncertainty_sources=[],
            model_limitations=[],
            information_gaps=[],
            self_improvement_signal="",
        ),
    )


def test_build_evaluation_record_reward_and_features() -> None:
    trace = _minimal_trace()
    outcome = DecisionOutcome(
        decision_id="d-1",
        user_took_recommended_action=True,
        actual_outcome="went well",
        user_reported_quality=4,
        reversed_later=False,
        timestamp="2026-02-01T00:00:00Z",
    )
    commit = DecisionCommit(
        decision_id="d-1",
        chosen_option_id="b",
        matches_recommendation=False,
        committed_at="2026-01-02T00:00:00Z",
    )
    row = build_evaluation_record(trace, outcome, commit=commit)
    assert row["decision_id"] == "d-1"
    assert row["reward"] == 0.8
    assert row["had_explicit_commit"] is True
    assert row["features"]["chosen_option_id"] == "b"
    assert row["features"]["chosen_same_as_recommend_id"] is False
    assert "composite_score_at_commit" in row["features"]


def test_append_evaluation_log_writes_jsonl(tmp_path: Path) -> None:
    from foresight_x.config import Settings

    s = Settings(foresight_data_dir=tmp_path)
    row = {"schema_version": 1, "decision_id": "x", "reward": 1.0}
    path = append_evaluation_log(row, settings=s)
    assert path.read_text(encoding="utf-8").strip().startswith('{"schema_version"')
