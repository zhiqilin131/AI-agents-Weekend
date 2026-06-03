"""Tests for option evaluation."""

from __future__ import annotations

from typing import Any

from foresight_x.schemas import (
    EvidenceBundle,
    Fact,
    Option,
    Reversibility,
    Scenario,
    SimulatedFuture,
    TimePressure,
    UserState,
)
from foresight_x.simulation.evaluator import evaluate_options


class FakeLLM:
    def __init__(self, response: Any, *, raise_error: bool = False) -> None:
        self.response = response
        self.raise_error = raise_error
        self.calls = 0

    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        self.calls += 1
        if self.raise_error:
            raise RuntimeError("LLM unavailable")
        return self.response


def _state() -> UserState:
    return UserState(
        raw_input="x",
        goals=["a", "b"],
        time_pressure=TimePressure.LOW,
        stress_level=3,
        workload=4,
        current_behavior="calm",
        decision_type="career",
        reversibility=Reversibility.REVERSIBLE,
    )


def _evidence() -> EvidenceBundle:
    return EvidenceBundle(facts=[Fact(text="steady demand", confidence=0.7)], base_rates=[], recent_events=[])


def _option(oid: str) -> Option:
    return Option(
        option_id=oid,
        name=f"Option {oid}",
        description="Growth path with manageable cost.",
        key_assumptions=["fit"],
        cost_of_reversal="low",
    )


def _future(oid: str) -> SimulatedFuture:
    return SimulatedFuture(
        option_id=oid,
        time_horizon="3 months",
        scenarios=[
            Scenario(label="best", trajectory="good", probability=0.25, key_drivers=["x"]),
            Scenario(label="base", trajectory="ok", probability=0.5, key_drivers=["y"]),
            Scenario(label="worst", trajectory="bad", probability=0.25, key_drivers=["z"]),
        ],
    )


def test_evaluate_options_feature_based_when_context_available() -> None:
    futures = [_future("a"), _future("b")]
    options = [_option("a"), _option("b")]
    evs = evaluate_options(futures, _state(), llm=None, options=options, evidence=_evidence())
    assert len(evs) == 2
    for e in evs:
        assert e.option_id in ("a", "b")
        assert 0 <= e.expected_value_score <= 10
        assert "Deterministic feature-based" in e.rationale


def test_evaluate_options_llm_ignored_for_scores() -> None:
    from foresight_x.schemas import OptionEvaluation

    fut = _future("only")
    llm_ev = OptionEvaluation(
        option_id="only",
        expected_value_score=7.0,
        risk_score=4.0,
        regret_score=3.0,
        uncertainty_score=5.0,
        goal_alignment_score=8.0,
        rationale="LLM rationale",
    )
    llm = FakeLLM(llm_ev)
    evs = evaluate_options(
        [fut],
        _state(),
        llm=llm,
        options=[_option("only")],
        evidence=_evidence(),
    )
    assert llm.calls == 0
    assert evs[0].rationale != "LLM rationale"
    assert evs[0].expected_value_score != 7.0


def test_evaluate_options_legacy_fallback_without_options() -> None:
    fut = _future("z")
    evs = evaluate_options([fut], _state(), llm=None)
    assert evs[0].option_id == "z"
    assert "Legacy fallback" in evs[0].rationale


def test_evaluate_options_llm_fallback_legacy_path() -> None:
    fut = _future("z")
    llm = FakeLLM(None, raise_error=True)
    evs = evaluate_options([fut], _state(), llm=llm)
    assert llm.calls == 0
    assert evs[0].option_id == "z"
