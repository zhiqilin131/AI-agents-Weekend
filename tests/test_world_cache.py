"""WorldKnowledge cache + Tavily (mocked) behavior."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import foresight_x.retrieval.world_cache as world_cache_mod
from llama_index.core.embeddings import MockEmbedding

from foresight_x.config import Settings
from foresight_x.retrieval.seed import ingest_world_markdown
from foresight_x.retrieval.tavily_client import build_tavily_query_for_decision
from foresight_x.retrieval.world_cache import WorldKnowledge, _cached_tavily_fact_eligible
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


def test_tavily_query_prioritizes_user_message() -> None:
    us = UserState(
        raw_input="Should we pursue intimacy given our boundaries?",
        goals=["understand tradeoffs"],
        time_pressure=TimePressure.LOW,
        stress_level=3,
        workload=3,
        current_behavior="deliberate",
        decision_type="general",
        reversibility=Reversibility.PARTIAL,
    )
    q = build_tavily_query_for_decision(us, "user_stated_priorities career growth " * 20)
    assert "intimacy" in q.lower() or "boundaries" in q.lower()
    assert q.startswith("Should we") or "Should we" in q[:120]


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
        Fact(
            text="Live web snippet about urgent offer comparison and recruiting.",
            source_url="https://x.test",
            confidence=0.7,
        )
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
    assert "recruiting" in br
    # Tavily hits are not pushed to recent_events (only base_rates).
    assert not any("live web snippet about recruiting" in (f.text or "").lower() for f in ev.recent_events)


def test_cached_tavily_fact_eligible_requires_query_signature_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Freeze "now" so max_age_days checks do not drift as CI calendar dates advance.
    class _FixedDateTime:
        @staticmethod
        def now(tz=None):
            return datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc)

        fromisoformat = staticmethod(datetime.fromisoformat)

    monkeypatch.setattr(world_cache_mod, "datetime", _FixedDateTime)

    md = {
        "from_tavily": True,
        "tavily_query_sig": "abc123",
        "tavily_ingested_at": "2026-05-10T12:00:00Z",
    }
    assert (
        _cached_tavily_fact_eligible(
            md,
            query_signature="zzz999",
            max_age_days=7,
            query_scoped=True,
        )
        is False
    )
    assert (
        _cached_tavily_fact_eligible(
            md,
            query_signature="abc123",
            max_age_days=7,
            query_scoped=True,
        )
        is True
    )
