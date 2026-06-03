"""Tests for auditable feature-based evaluation (no LLM numeric scoring)."""

from __future__ import annotations

from typing import Any

from foresight_x.schemas import (
    EvidenceBundle,
    Fact,
    MemoryBundle,
    Option,
    Reversibility,
    Scenario,
    SimulatedFuture,
    TimePressure,
    UserState,
)
from foresight_x.simulation.evaluator import evaluate_options, evaluate_options_from_features
from foresight_x.simulation.feature_extractor import extract_option_features
from foresight_x.simulation.feature_schemas import OptionFeatureVector
from foresight_x.simulation.feature_scorer import score_option_from_features
from foresight_x.simulation.future_reliability import assess_future_reliability


class FakeLLM:
    def __init__(self, response: Any = None, *, raise_error: bool = False) -> None:
        self.response = response
        self.raise_error = raise_error
        self.calls = 0

    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        self.calls += 1
        if self.raise_error:
            raise RuntimeError("LLM unavailable")
        return self.response


def _state(**kwargs: Any) -> UserState:
    base = dict(
        raw_input="Should I take the remote role with growth upside?",
        goals=["career growth", "work-life balance"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="thinking",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    base.update(kwargs)
    return UserState(**base)


def _evidence(**kwargs: Any) -> EvidenceBundle:
    return EvidenceBundle(
        facts=kwargs.get("facts", [Fact(text="Remote roles widen talent pools.", confidence=0.75)]),
        base_rates=kwargs.get("base_rates", []),
        recent_events=kwargs.get("recent_events", []),
    )


def _option(**kwargs: Any) -> Option:
    base = dict(
        option_id="opt_a",
        name="Accept remote offer",
        description="Start in two weeks with growth upside.",
        key_assumptions=["manager support"],
        cost_of_reversal="medium",
    )
    base.update(kwargs)
    return Option(**base)


def _future(oid: str = "opt_a", *, generic: bool = False) -> SimulatedFuture:
    if generic:
        return SimulatedFuture(
            option_id=oid,
            time_horizon="3 months",
            scenarios=[
                Scenario(
                    label="best",
                    trajectory="Things go well with manageable disruption.",
                    probability=0.33,
                    key_drivers=["execution"],
                ),
                Scenario(
                    label="base",
                    trajectory="Partial progress with tradeoffs.",
                    probability=0.34,
                    key_drivers=["uncertainty"],
                ),
                Scenario(
                    label="worst",
                    trajectory="Underperforms with costly recovery.",
                    probability=0.33,
                    key_drivers=["downside"],
                ),
            ],
        )
    return SimulatedFuture(
        option_id=oid,
        time_horizon="3 months",
        scenarios=[
            Scenario(
                label="best",
                trajectory="Career growth with manageable workload and deadline met.",
                probability=0.3,
                key_drivers=["goal alignment", "time fit"],
            ),
            Scenario(
                label="base",
                trajectory="Mixed progress; stress and money cost remain.",
                probability=0.5,
                key_drivers=["workload", "constraint"],
            ),
            Scenario(
                label="worst",
                trajectory="High downside if irreversible commitment fails; recovery is slow.",
                probability=0.2,
                key_drivers=["risk", "reversibility"],
            ),
        ],
    )


def test_evaluator_does_not_call_llm_for_numeric_scores() -> None:
    llm = FakeLLM(response={"expected_value_score": 9.9})
    options = [_option()]
    futures = [_future()]
    evs = evaluate_options(
        futures,
        _state(),
        llm,
        options=options,
        evidence=_evidence(),
    )
    assert llm.calls == 0
    assert evs[0].expected_value_score != 9.9
    assert "Deterministic feature-based" in evs[0].rationale


def test_same_inputs_produce_identical_evaluations() -> None:
    options = [_option(), _option(option_id="opt_b", name="Delay", description="Ask for extension.")]
    state = _state()
    evidence = _evidence()
    a = evaluate_options_from_features(options, state, evidence)
    b = evaluate_options_from_features(options, state, evidence)
    assert [x.model_dump() for x in a] == [x.model_dump() for x in b]


def test_unknown_fields_increase_uncertainty() -> None:
    sparse = OptionFeatureVector(option_id="x", missing_critical_info_count=6)
    rich = OptionFeatureVector(
        option_id="x",
        time_cost_level="medium",
        money_cost_level="low",
        stress_load_level="medium",
        workload_level="medium",
        reversibility_level="high",
        downside_severity_level="low",
        upside_potential_level="high",
        goal_alignment_level="high",
        missing_critical_info_count=0,
        provenance=[],
        field_status={
            "time_cost_level": "known",
            "money_cost_level": "known",
            "stress_load_level": "known",
            "workload_level": "known",
            "reversibility_level": "known",
            "downside_severity_level": "known",
            "upside_potential_level": "known",
            "goal_alignment_level": "known",
        },
    )
    u_sparse = score_option_from_features(sparse).uncertainty_score
    u_rich = score_option_from_features(rich).uncertainty_score
    assert u_sparse > u_rich


def test_hard_constraint_violation_lowers_ev_and_goal_align_raises_risk() -> None:
    base_fv = extract_option_features(
        _option(description="Commit now sprint all-in immediately."),
        _state(stress_level=9, workload=9, time_pressure=TimePressure.HIGH, deadline_hint="Friday"),
        _evidence(),
    )
    clean_fv = extract_option_features(
        _option(option_id="opt_clean", description="Light research with manageable workload."),
        _state(stress_level=3, workload=3),
        _evidence(),
    )
    base_ev = score_option_from_features(base_fv)
    clean_ev = score_option_from_features(clean_fv)
    assert base_fv.hard_constraint_violations
    assert base_ev.expected_value_score < clean_ev.expected_value_score
    assert base_ev.goal_alignment_score <= clean_ev.goal_alignment_score + 0.01
    assert base_ev.risk_score > clean_ev.risk_score


def test_reversibility_high_lowers_risk_and_regret_vs_irreversible() -> None:
    """High reversibility must reduce risk/regret — not inflate them."""
    irreversible = OptionFeatureVector(
        option_id="hard",
        reversibility_level="low",
        switching_cost_level="high",
        downside_severity_level="high",
        opportunity_cost_level="medium",
        stress_load_level="medium",
        workload_level="medium",
        constraint_conflict_level="low",
        field_status={
            "reversibility_level": "known",
            "switching_cost_level": "known",
            "downside_severity_level": "known",
            "opportunity_cost_level": "known",
            "stress_load_level": "known",
            "workload_level": "known",
            "constraint_conflict_level": "known",
        },
    )
    reversible = irreversible.model_copy(
        update={
            "option_id": "easy",
            "reversibility_level": "high",
            "switching_cost_level": "low",
            "downside_severity_level": "low",
            "opportunity_cost_level": "low",
        }
    )
    hard = score_option_from_features(irreversible)
    easy = score_option_from_features(reversible)
    assert easy.risk_score < hard.risk_score
    assert easy.regret_score < hard.regret_score


def test_ev_does_not_double_count_goal_alignment() -> None:
    """Goal affects goal_alignment_score; EV should not change when only goal differs."""
    base = OptionFeatureVector(
        option_id="a",
        upside_potential_level="medium",
        goal_alignment_level="low",
        time_cost_level="medium",
        money_cost_level="medium",
        opportunity_cost_level="medium",
        field_status={
            "upside_potential_level": "known",
            "goal_alignment_level": "known",
            "time_cost_level": "known",
            "money_cost_level": "known",
            "opportunity_cost_level": "known",
        },
    )
    high_goal = base.model_copy(update={"goal_alignment_level": "high"})
    assert score_option_from_features(base).expected_value_score == score_option_from_features(high_goal).expected_value_score
    assert score_option_from_features(high_goal).goal_alignment_score > score_option_from_features(base).goal_alignment_score


def test_irreversible_high_downside_raises_risk_and_regret() -> None:
    fragile = OptionFeatureVector(
        option_id="f",
        reversibility_level="low",
        switching_cost_level="high",
        downside_severity_level="high",
        opportunity_cost_level="high",
        stress_load_level="medium",
        workload_level="medium",
        constraint_conflict_level="low",
        field_status={
            "reversibility_level": "known",
            "switching_cost_level": "known",
            "downside_severity_level": "known",
            "opportunity_cost_level": "known",
            "stress_load_level": "known",
            "workload_level": "known",
            "constraint_conflict_level": "known",
        },
    )
    safer = OptionFeatureVector(
        option_id="s",
        reversibility_level="high",
        switching_cost_level="low",
        downside_severity_level="low",
        opportunity_cost_level="low",
        stress_load_level="medium",
        workload_level="medium",
        constraint_conflict_level="low",
        field_status={
            "reversibility_level": "known",
            "switching_cost_level": "known",
            "downside_severity_level": "known",
            "opportunity_cost_level": "known",
            "stress_load_level": "known",
            "workload_level": "known",
            "constraint_conflict_level": "known",
        },
    )
    fragile_scores = score_option_from_features(fragile)
    safer_scores = score_option_from_features(safer)
    assert fragile_scores.risk_score > safer_scores.risk_score
    assert fragile_scores.regret_score > safer_scores.regret_score


def test_futures_reliability_gate_marks_weak_generic_as_explanation_only() -> None:
    report = assess_future_reliability(
        _future(generic=True),
        _option(),
        _state(),
        _evidence(facts=[]),
    )
    assert report.score_use in ("explanation_only", "needs_more_info", "discard")
    assert "expected_value_score" in report.blocked_uses


def test_futures_reliability_does_not_boost_ev_risk_regret() -> None:
    without = evaluate_options_from_features(
        [_option()],
        _state(),
        _evidence(),
        futures=None,
    )[0]
    strong_future = _future()
    weak_future = _future(generic=True)
    with_strong = evaluate_options_from_features(
        [_option()],
        _state(),
        _evidence(),
        futures=[strong_future],
    )[0]
    with_weak = evaluate_options_from_features(
        [_option()],
        _state(),
        _evidence(facts=[]),
        futures=[weak_future],
    )[0]
    # Weak futures may increase uncertainty only — never inflate EV or reduce Risk/Regret.
    assert with_weak.uncertainty_score >= without.uncertainty_score - 0.01
    assert abs(with_strong.expected_value_score - without.expected_value_score) <= 0.01
    assert abs(with_strong.risk_score - without.risk_score) <= 0.01
    assert abs(with_strong.regret_score - without.regret_score) <= 0.01


def test_feature_path_via_evaluate_options_with_context() -> None:
    options = [_option()]
    futures = [_future()]
    evs = evaluate_options(
        futures,
        _state(),
        llm=None,
        options=options,
        evidence=_evidence(),
        memory=MemoryBundle(
            similar_past_decisions=[],
            behavioral_patterns=["avoids conflict"],
            prior_outcomes_summary="",
        ),
    )
    assert len(evs) == 1
    assert "Deterministic feature-based" in evs[0].rationale
