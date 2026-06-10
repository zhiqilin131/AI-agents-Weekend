"""Tests for the Graphiti memory backend wrapper (no network, no LLM calls)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from foresight_x.config import load_settings
from foresight_x.memory_graph.graphiti_backend import (
    GraphitiMemoryBackend,
    _sanitize_group,
    graphiti_available,
)
from foresight_x.schemas import UserState


def _settings(tmp_path, **overrides):
    s = load_settings()
    return s.model_copy(update={"foresight_data_dir": tmp_path, **overrides})


def _user_state(text: str) -> UserState:
    return UserState(
        raw_input=text,
        active_user_id="t",
        goals=[],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="deciding",
        decision_type="relationship",
        reversibility="partial",
    )


def test_sanitize_group() -> None:
    assert _sanitize_group("Bob") == "Bob"
    assert _sanitize_group("a b/c@d") == "a_b_c_d"
    assert _sanitize_group("") == "default"


def test_graphiti_available_requires_openai_key(tmp_path) -> None:
    s = _settings(tmp_path, openai_api_key="")
    assert not graphiti_available(s)


def test_backend_none_when_local_mode(tmp_path) -> None:
    from foresight_x.memory_graph.graphiti_backend import get_graphiti_backend

    s = _settings(tmp_path, graph_backend="local", openai_api_key="sk-test")
    assert get_graphiti_backend("u1", s) is None


def test_enqueue_dedupes_via_ledger(tmp_path) -> None:
    s = _settings(tmp_path, openai_api_key="sk-test", graphiti_ingest_enabled=True)
    backend = GraphitiMemoryBackend("test-user", s)
    backend._ingested_keys.add("shadow:abc")
    from foresight_x.memory_graph.graphiti_backend import _Episode
    from datetime import datetime, timezone

    accepted = backend._enqueue(
        _Episode(
            key="shadow:abc",
            name="shadow:abc",
            body="x",
            source_description="t",
            reference_time=datetime.now(timezone.utc),
        )
    )
    assert not accepted


def test_to_bundle_maps_nodes_edges_and_decisions(tmp_path) -> None:
    s = _settings(tmp_path, openai_api_key="sk-test")
    backend = GraphitiMemoryBackend("test-user2", s)

    nodes = [
        SimpleNamespace(uuid="n1", name="Girlfriend", labels=["Entity", "Person"], summary="partner of user"),
        SimpleNamespace(uuid="n2", name="Breakup", labels=["Entity"], summary=""),
    ]
    edges = [
        SimpleNamespace(
            uuid="e1",
            source_node_uuid="n1",
            target_node_uuid="n2",
            fact="User broke up with their girlfriend in June",
            episodes=[],
        )
    ]
    episodes = [SimpleNamespace(uuid="ep1", name="decision:abc-123")]
    results = SimpleNamespace(
        nodes=nodes,
        edges=edges,
        episodes=episodes,
        node_reranker_scores=[0.9, 0.4],
        edge_reranker_scores=[0.8],
        communities=[],
        community_reranker_scores=[],
    )
    bundle = backend._to_bundle(results, top_k=5)
    assert bundle is not None
    assert bundle.algorithm == "graphiti_hybrid_rrf_v1"
    assert bundle.top_nodes[0].label == "Girlfriend"
    assert bundle.top_nodes[0].node_type == "person"
    assert bundle.top_nodes[0].score == 1.0
    assert "broke up" in bundle.top_nodes[0].why
    assert "abc-123" in bundle.surfaced_decision_ids


def test_to_bundle_empty_returns_none(tmp_path) -> None:
    s = _settings(tmp_path, openai_api_key="sk-test")
    backend = GraphitiMemoryBackend("test-user3", s)
    results = SimpleNamespace(
        nodes=[],
        edges=[],
        episodes=[],
        node_reranker_scores=[],
        edge_reranker_scores=[],
        communities=[],
        community_reranker_scores=[],
    )
    assert backend._to_bundle(results, top_k=5) is None


def test_influence_falls_back_to_none_without_client(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path, openai_api_key="sk-test")
    backend = GraphitiMemoryBackend("test-user4", s)
    monkeypatch.setattr(backend, "_ensure_client", lambda: None)
    assert backend.influence_for(_user_state("我和我女朋友分手了")) is None


def test_service_facade_falls_back_to_legacy(tmp_path, monkeypatch) -> None:
    """TemporalGraphMemory uses legacy PPR when graphiti returns nothing."""
    from foresight_x.memory_graph.service import TemporalGraphMemory

    s = _settings(tmp_path, graph_backend="local", graph_enabled=True)
    mem = TemporalGraphMemory("legacy-user", settings=s)
    assert mem._graphiti is None
    # Empty graph → influence is None, no crash.
    assert mem.influence_for(_user_state("any question")) is None
    status = mem.backend_status()
    assert status["backend"] == "local"
    assert status["legacy_nodes"] == 0


def test_status_shape(tmp_path) -> None:
    s = _settings(tmp_path, openai_api_key="sk-test")
    backend = GraphitiMemoryBackend("test-user5", s)
    st = backend.status()
    assert st["backend"] == "graphiti"
    assert "ingest_queue_depth" in st
    assert "db_path" in st
