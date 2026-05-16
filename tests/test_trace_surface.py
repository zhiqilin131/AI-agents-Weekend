"""FOR-24: DecisionTrace runtime resilience metadata and report_surface.how_answered."""

from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.decision.report_surface import build_report_surface
from foresight_x.harness.trace import load_decision_trace, save_decision_trace
from foresight_x.orchestration.pipeline import PipelineContext, run_pipeline
from foresight_x.schemas import Degradation, RuntimeContext


@pytest.fixture
def isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    return Settings(foresight_data_dir=tmp_path)


def test_runtime_fields_on_offline_pipeline(isolated_settings: Settings) -> None:
    ctx = PipelineContext(settings=isolated_settings, llm=None, user_memory=None, world=None)
    trace = run_pipeline(
        ctx,
        "Should I take the new role offer?",
        decision_id="trace-surface-offline",
        persist_trace=False,
    )
    assert trace.runtime is not None
    assert trace.runtime.pipeline_started_at
    assert trace.runtime.per_stage_latency_ms
    assert trace.runtime.provider_per_stage.get("infer") == "deterministic"
    assert trace.degradations
    assert trace.report_surface is not None
    assert trace.report_surface.how_answered


def test_legacy_trace_loads_without_runtime(isolated_settings: Settings) -> None:
    ctx = PipelineContext(settings=isolated_settings, llm=None, user_memory=None, world=None)
    trace = run_pipeline(
        ctx,
        "Quick decision about lunch.",
        decision_id="legacy-trace",
        persist_trace=True,
    )
    path = isolated_settings.traces_dir / "legacy-trace.json"
    assert path.is_file()
    loaded = load_decision_trace("legacy-trace", settings=isolated_settings)
    assert loaded.decision_id == "legacy-trace"
    assert loaded.user_state.raw_input


def test_how_answered_with_fallback_reason() -> None:
    from foresight_x.schemas import (
        DecisionTrace,
        EvidenceBundle,
        MemoryBundle,
        Option,
        OptionEvaluation,
        RationalityReport,
        Recommendation,
        Reflection,
        Reversibility,
        SimulatedFuture,
        TimePressure,
        UserState,
    )

    trace = DecisionTrace(
        decision_id="x",
        timestamp="2026-05-16T00:00:00Z",
        user_state=UserState(
            raw_input="job offer",
            goals=["decide"],
            time_pressure=TimePressure.MEDIUM,
            stress_level=5,
            workload=5,
            current_behavior="weighing",
            decision_type="career",
            reversibility=Reversibility.PARTIAL,
        ),
        memory=MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary=""),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[], live=False),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.8,
            recommended_slowdowns=[],
        ),
        options=[
            Option(
                option_id="o1",
                name="Accept",
                description="Take the role",
                key_assumptions=[],
                cost_of_reversal="medium",
            )
        ],
        futures=[],
        evaluations=[
            OptionEvaluation(
                option_id="o1",
                expected_value_score=7.0,
                risk_score=3.0,
                regret_score=2.0,
                uncertainty_score=4.0,
                goal_alignment_score=8.0,
                rationale="test",
            )
        ],
        recommendation=Recommendation(
            chosen_option_id="o1",
            reasoning="Because it fits.",
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
        runtime=RuntimeContext(
            llm_provider_used="anthropic:claude-3",
            llm_fallback_reason="primary_429",
            provider_per_stage={"finalize": "anthropic:claude-3"},
        ),
        degradations=[
            Degradation(
                component="tavily",
                stage="retrieve",
                reason="outage",
                error_kind="outage",
            )
        ],
    )
    surface = build_report_surface(trace)
    assert "backup anthropic:claude-3" in surface.how_answered
    assert "primary_429" in surface.how_answered
    assert "Tavily cached" in surface.how_answered
