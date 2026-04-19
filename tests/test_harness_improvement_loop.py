"""Tests for Harness improvement loop."""

from __future__ import annotations

from pathlib import Path

import pytest
from llama_index.core.embeddings import MockEmbedding

from foresight_x.config import Settings
from foresight_x.harness.improvement_loop import apply_outcome_to_memory
from foresight_x.orchestration.pipeline import PipelineContext, run_pipeline
from foresight_x.retrieval.memory import UserMemory
from foresight_x.schemas import DecisionOutcome


def test_apply_outcome_to_memory_reindexes_trace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Constructor kwargs are overridden by env / .env; pin dirs for an isolated Chroma store.
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TAVILY_API_KEY", "")
    settings = Settings()
    trace = run_pipeline(
        PipelineContext(settings=settings, llm=None, user_memory=None, world=None),
        "Should I ask for one week extension?",
        decision_id="imp-1",
        persist_trace=True,
    )
    mem = UserMemory("demo_user", settings=settings, embed_model=MockEmbedding(embed_dim=1536))
    outcome = DecisionOutcome(
        decision_id="imp-1",
        user_took_recommended_action=True,
        actual_outcome="Extension granted.",
        user_reported_quality=5,
        reversed_later=False,
        timestamp="2026-04-18T00:00:00Z",
    )
    loaded_trace = apply_outcome_to_memory(
        "imp-1",
        outcome,
        settings=settings,
        user_memory=mem,
    )
    assert loaded_trace.decision_id == "imp-1"

    bundle = mem.retrieve(trace.user_state, top_k=5)
    assert any(p.decision_id == "imp-1" for p in bundle.similar_past_decisions)
