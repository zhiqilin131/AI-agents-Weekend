"""Tests for minimal eval harness."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings
from foresight_x.harness.eval_harness import eval_harness
from foresight_x.harness.outcome_tracker import save_decision_outcome
from foresight_x.harness.trace import save_decision_trace
from foresight_x.orchestration.pipeline import PipelineContext, run_pipeline
from foresight_x.schemas import DecisionOutcome


def test_eval_harness_counts_traces_and_outcomes(tmp_path: Path) -> None:
    traces_dir = tmp_path / "traces"
    outcomes_dir = tmp_path / "outcomes"
    settings = Settings(
        chroma_persist_dir=tmp_path / "chroma",
        foresight_data_dir=tmp_path / "data",
        openai_api_key="test",
        tavily_api_key="",
    )
    trace = run_pipeline(
        PipelineContext(settings=settings, llm=None, user_memory=None, world=None),
        "Should I accept this role now?",
        decision_id="eval-1",
        persist_trace=False,
    )
    save_decision_trace(trace, settings=settings, traces_dir=traces_dir)
    save_decision_outcome(
        DecisionOutcome(
            decision_id="eval-1",
            user_took_recommended_action=True,
            actual_outcome="Went fine",
            user_reported_quality=4,
            reversed_later=False,
            timestamp="2026-04-18T00:00:00Z",
        ),
        settings=settings,
        outcomes_dir=outcomes_dir,
    )

    report = eval_harness(settings=settings, traces_dir=traces_dir, outcomes_dir=outcomes_dir)
    assert report.trace_count == 1
    assert report.outcome_count == 1
    assert "v0 report" in report.notes
