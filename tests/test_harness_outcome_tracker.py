"""Tests for harness outcome tracking."""

from __future__ import annotations

from pathlib import Path

import pytest
from llama_index.core.embeddings import MockEmbedding

from foresight_x.config import Settings
from foresight_x.harness.outcome_tracker import ask_outcome, load_decision_outcome, save_decision_outcome
from foresight_x.orchestration.pipeline import PipelineContext, run_pipeline
from foresight_x.retrieval.memory import UserMemory
from foresight_x.schemas import DecisionOutcome


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        chroma_persist_dir=tmp_path / "chroma",
        foresight_data_dir=tmp_path / "data",
        openai_api_key="test",
        tavily_api_key="",
    )


def test_save_and_load_decision_outcome(settings: Settings) -> None:
    outcome = DecisionOutcome(
        decision_id="d-test",
        user_took_recommended_action=True,
        actual_outcome="It worked well.",
        user_reported_quality=5,
        reversed_later=False,
        timestamp="2026-04-18T00:00:00Z",
    )
    path = save_decision_outcome(outcome, settings=settings)
    assert path == settings.outcomes_dir / "d-test.json"
    loaded = load_decision_outcome("d-test", settings=settings)
    assert loaded == outcome


def test_ask_outcome_writes_outcome_and_updates_memory(settings: Settings) -> None:
    trace = run_pipeline(
        PipelineContext(settings=settings, llm=None, user_memory=None, world=None),
        "I have a job offer deadline on Friday.",
        decision_id="dec-123",
        persist_trace=True,
    )
    mem = UserMemory("demo_user", settings=settings, embed_model=MockEmbedding(embed_dim=1536))

    answers = iter(["y", "Asked for extension and got it.", "4", "n"])

    def fake_input(_prompt: str) -> str:
        return next(answers)

    out = ask_outcome(
        trace.decision_id,
        settings=settings,
        input_fn=fake_input,
        user_memory=mem,
        apply_improvement=True,
    )
    assert out.decision_id == "dec-123"
    assert (settings.outcomes_dir / "dec-123.json").is_file()

    bundle = mem.retrieve(trace.user_state, top_k=5)
    assert any(p.decision_id == "dec-123" for p in bundle.similar_past_decisions)
