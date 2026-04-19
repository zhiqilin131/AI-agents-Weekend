"""Seed loaders write into indices without external APIs."""

from __future__ import annotations

from pathlib import Path

import pytest
from llama_index.core.embeddings import MockEmbedding

from foresight_x.config import Settings
from foresight_x.retrieval.memory import UserMemory
from foresight_x.retrieval.seed import ingest_memory_json, ingest_world_markdown
from foresight_x.retrieval.world_cache import WorldKnowledge
from foresight_x.schemas import Reversibility, TimePressure, UserState


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    """Isolate Chroma from repo ``data/chroma`` (integration tests may ingest Tavily mocks)."""
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path / "data"))
    return Settings(
        openai_api_key="test",
        tavily_api_key="test",
    )


def test_ingest_memory_json_count(settings: Settings) -> None:
    emb = MockEmbedding(embed_dim=1536)
    mem = UserMemory("demo_user", settings=settings, embed_model=emb)
    n = ingest_memory_json(mem)
    assert n == 5
    st = UserState(
        raw_input="internship and full-time tradeoff",
        goals=["growth"],
        time_pressure=TimePressure.HIGH,
        stress_level=6,
        workload=5,
        current_behavior="thinking",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    bundle = mem.retrieve(st, top_k=5)
    assert len(bundle.similar_past_decisions) >= 1


def test_ingest_world_markdown(settings: Settings) -> None:
    emb = MockEmbedding(embed_dim=1536)
    wk = WorldKnowledge(settings=settings, embed_model=emb, tavily=None)
    ingest_world_markdown(wk)
    st = UserState(
        raw_input="compare offers",
        goals=["fit"],
        time_pressure=TimePressure.LOW,
        stress_level=2,
        workload=3,
        current_behavior="calm",
        decision_type="career",
        reversibility=Reversibility.REVERSIBLE,
    )
    ev = wk.retrieve(st, min_cache_hits=20, top_k=5)
    assert len(ev.facts) + len(ev.base_rates) >= 1
