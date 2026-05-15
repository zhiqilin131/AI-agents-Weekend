from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from foresight_x.orchestration import llm_gateway
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    NextAction,
    Option,
    OptionEvaluation,
    RationalityReport,
    Recommendation,
    Reflection,
    Reversibility,
    TimePressure,
    UserState,
)
from tests.eval.runner import replay
from tests.eval.runner import run as eval_run


def _fake_trace(decision_id: str, raw_input: str) -> DecisionTrace:
    return DecisionTrace(
        decision_id=decision_id,
        timestamp="2026-05-14T00:00:00Z",
        original_user_input=raw_input,
        user_state=UserState(
            raw_input=raw_input,
            goals=["stability"],
            time_pressure=TimePressure.MEDIUM,
            stress_level=5,
            workload=5,
            current_behavior="evaluating",
            decision_type="career",
            reversibility=Reversibility.PARTIAL,
        ),
        memory=MemoryBundle(
            similar_past_decisions=[],
            behavioral_patterns=[],
            prior_outcomes_summary="",
        ),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.8,
            recommended_slowdowns=[],
        ),
        options=[
            Option(
                option_id="opt_a",
                name="Accept offer",
                description="Take it now",
                key_assumptions=["fit"],
                cost_of_reversal="medium",
            )
        ],
        futures=[],
        evaluations=[
            OptionEvaluation(
                option_id="opt_a",
                expected_value_score=7.0,
                risk_score=4.0,
                regret_score=3.0,
                uncertainty_score=5.0,
                goal_alignment_score=8.0,
                rationale="reasonable",
            )
        ],
        recommendation=Recommendation(
            chosen_option_id="opt_a",
            reasoning="Accept for now with a 30-day check-in.",
            next_actions=[NextAction(action="Draft acceptance email")],
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


def test_runner_smoke_writes_report(monkeypatch, tmp_path: Path) -> None:
    # Required by request: mock LLMGateway structured_predict to avoid real token usage.
    monkeypatch.setattr(llm_gateway.LLMGateway, "structured_predict", lambda *args, **kwargs: None)
    monkeypatch.setattr(eval_run, "_llm_preflight", lambda model_id: (True, None))
    monkeypatch.setattr(eval_run, "verify_model_available", lambda model_id, settings: None)

    def fake_run_pipeline(ctx, raw_input, *, decision_id=None, persist_trace=False, **kwargs):
        did = decision_id or "fake-decision"
        return _fake_trace(did, raw_input)

    def fake_run_shadow_turn(messages, **kwargs):
        return SimpleNamespace(reply="Let's slow this down and choose one concrete next step.")

    monkeypatch.setattr(replay, "run_pipeline", fake_run_pipeline)
    monkeypatch.setattr(replay, "run_shadow_turn", fake_run_shadow_turn)

    out_dir = tmp_path / "reports"
    rc = eval_run.main(
        [
            "--scenarios",
            "decision-01,shadow-01",
            "--out",
            str(out_dir),
            "--model",
            "gpt-4o-mini",
        ]
    )
    assert rc == 0

    reports = sorted(out_dir.glob("eval-*.json"))
    assert reports, "report file not created"
    report = json.loads(reports[-1].read_text(encoding="utf-8"))

    for key in ("run_id", "commit_sha", "model_id", "total_llm_calls", "scenarios", "aggregate"):
        assert key in report

    assert len(report["scenarios"]) == 2
    for row in report["scenarios"]:
        metrics = row["metrics"]
        assert "retrieval" in metrics
        assert "coverage" in metrics
        assert "recommendation" in metrics
        assert "latency" in metrics
        assert "safety" in metrics
        assert "llm_calls" in metrics

    by_cat = report["aggregate"]["pass_rate_by_category"]
    assert "decision" in by_cat
    assert "shadow" in by_cat
