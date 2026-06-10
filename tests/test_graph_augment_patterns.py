"""Graph influence must replace stale behavioral_patterns lines, not append."""

from __future__ import annotations

from foresight_x.config import load_settings
from foresight_x.orchestration.pipeline import _augment_memory_with_graph
from foresight_x.schemas import GraphInfluenceBundle, InfluenceNode, MemoryBundle, UserState


def test_augment_memory_strips_stale_graph_patterns_and_prepends_current() -> None:
    settings = load_settings().model_copy(update={"graph_enabled": True})
    us = UserState(
        raw_input="breakup compensation question",
        active_user_id="Bob",
        goals=[],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="shadow_chat",
        decision_type="relationship",
        reversibility="partial",
    )
    mem = MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=[
            "Graph influence: Salmon (0.77), Shadow chat turn (0.23)",
            "Retrieval themes: choice, career",
        ],
        prior_outcomes_summary="",
    )
    influence = GraphInfluenceBundle(
        algorithm="graphiti_hybrid_rrf_v1",
        top_nodes=[
            InfluenceNode(
                node_id="g1",
                label="ex-girlfriend",
                node_type="entity",
                layer="concept",
                score=1.0,
                why="related",
            )
        ],
    )
    out = _augment_memory_with_graph(mem, us, settings=settings, influence=influence)
    assert out.behavioral_patterns[0].startswith("Graph influence: ex-girlfriend")
    assert not any("Salmon" in p for p in out.behavioral_patterns)
    assert any(p.startswith("Retrieval themes:") for p in out.behavioral_patterns)
