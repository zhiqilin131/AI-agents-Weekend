"""WorldKnowledge cache + Tavily (mocked) behavior."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from llama_index.core.embeddings import MockEmbedding

from foresight_x.config import Settings
from foresight_x.retrieval.seed import ingest_world_markdown
from foresight_x.retrieval.world_cache import WorldKnowledge
from foresight_x.schemas import Fact, Reversibility, TimePressure, UserState


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    chroma = tmp_path / "chroma"
    data = tmp_path / "data"
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(chroma))
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(data))
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    return Settings()


@pytest.fixture
def embed_model() -> MockEmbedding:
    return MockEmbedding(embed_dim=1536)


def test_deprecated_internship_base_rate_filtered(settings: Settings, embed_model: MockEmbedding) -> None:
    wk = WorldKnowledge(settings=settings, embed_model=embed_model, tavily=None)
    wk.insert_text(
        "Base rate heuristic: many students receive only one strong internship offer per cycle; "
        "asking for a short extension is common and often granted.",
        kind="base_rate",
        confidence=0.7,
        packaged_seed=True,
    )
    state = UserState(
        raw_input="compare offers",
        goals=["fit"],
        time_pressure=TimePressure.LOW,
        stress_level=2,
        workload=3,
        current_behavior="calm",
        decision_type="career",
        reversibility=Reversibility.REVERSIBLE,
    )
    ev = wk.retrieve(state, min_cache_hits=1, top_k=8)
    joined = " ".join(f.text for f in ev.base_rates).lower()
    assert "internship offer per cycle" not in joined


def test_cache_only_no_tavily(settings: Settings, embed_model: MockEmbedding) -> None:
    wk = WorldKnowledge(settings=settings, embed_model=embed_model, tavily=None)
    ingest_world_markdown(wk)
    state = UserState(
        raw_input="Should I negotiate internship deadline?",
        goals=["better information"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=4,
        workload=5,
        current_behavior="deliberate",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    ev = wk.retrieve(state, min_cache_hits=10, top_k=4)
    assert len(ev.facts) + len(ev.base_rates) >= 1


def test_tavily_supplements_when_sparse(settings: Settings, embed_model: MockEmbedding) -> None:
    mock_gw = MagicMock()
    mock_gw.search_as_facts.return_value = [
        Fact(text="Live web snippet about recruiting.", source_url="https://x.test", confidence=0.7)
    ]
    wk = WorldKnowledge(settings=settings, embed_model=embed_model, tavily=mock_gw)
    state = UserState(
        raw_input="urgent offer comparison",
        goals=["maximize EV"],
        time_pressure=TimePressure.HIGH,
        stress_level=9,
        workload=8,
        current_behavior="rushed",
        decision_type="career",
        reversibility=Reversibility.IRREVERSIBLE,
        deadline_hint="tomorrow",
    )
    ev = wk.retrieve(state, min_cache_hits=5, top_k=3)
    assert mock_gw.search_as_facts.called
    br = " ".join(f.text for f in ev.base_rates).lower()
    assert "live web snippet about recruiting" in br
    # Tavily hits are not pushed to recent_events (only base_rates).
    assert not any("live web snippet about recruiting" in (f.text or "").lower() for f in ev.recent_events)
