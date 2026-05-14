from __future__ import annotations

from foresight_x.memory_graph.activation import build_influence_bundle
from foresight_x.memory_graph.extractor import concept_links_from_user_state
from foresight_x.memory_graph.models import GraphNode, GraphSnapshot
from foresight_x.schemas import ProfileMemoryFact, UserState


def _state(raw_input: str, facts: list[ProfileMemoryFact]) -> UserState:
    return UserState(
        raw_input=raw_input,
        goals=[],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type="career",
        reversibility="partial",
        profile_memory_facts=facts,
    )


def test_safety_memory_not_seeded_for_non_safety_query() -> None:
    facts = [
        ProfileMemoryFact(
            category="constraints",
            text="I am allergic to seafood.",
            subject_ref="user",
            predicate="is_allergic_to",
            object_value="seafood",
        ),
        ProfileMemoryFact(
            category="views",
            text="I am considering attending the World Cup.",
            subject_ref="user",
            predicate="considering",
            object_value="attending the World Cup",
        ),
    ]
    links = concept_links_from_user_state(
        _state(
            raw_input="Should I prioritize attending the World Cup or focus on my internship?",
            facts=facts,
        )
    )
    labels = [x.label.lower() for x in links]
    assert any("world cup" in x for x in labels)
    assert not any("seafood" in x or "allergic" in x for x in labels)


def test_safety_memory_kept_for_food_safety_query() -> None:
    facts = [
        ProfileMemoryFact(
            category="constraints",
            text="I am allergic to seafood.",
            subject_ref="user",
            predicate="is_allergic_to",
            object_value="seafood",
        )
    ]
    links = concept_links_from_user_state(
        _state(
            raw_input="Where should I eat tonight given my seafood allergy?",
            facts=facts,
        )
    )
    labels = [x.label.lower() for x in links]
    assert any("seafood" in x or "allergic" in x for x in labels)


def test_influence_bundle_downweights_off_topic_concepts() -> None:
    snapshot = GraphSnapshot(
        user_id="u1",
        nodes=[
            GraphNode(
                node_id="concept:value:world_cup",
                layer="concept",
                node_type="value",
                label="World Cup",
                created_at="2026-01-01T00:00:00Z",
                metadata={},
            ),
            GraphNode(
                node_id="event:decision:d1",
                layer="event",
                node_type="decision",
                label="Decision d1",
                created_at="2026-01-01T00:00:00Z",
                metadata={"decision_id": "d1"},
            ),
            GraphNode(
                node_id="concept:belief:salmon",
                layer="concept",
                node_type="belief",
                label="user hates raw salmon fish",
                created_at="2026-01-01T00:00:00Z",
                metadata={},
            ),
        ],
        edges=[],
        updated_at="2026-01-01T00:00:00Z",
    )
    seeds = {"concept:value:world_cup": 1.0}
    ranks = {
        "concept:value:world_cup": 0.45,
        "event:decision:d1": 0.30,
        "concept:belief:salmon": 0.25,
    }
    bundle = build_influence_bundle(
        snapshot,
        ranks,
        seeds,
        min_score=0.0,
        top_k=5,
        query_text="Should I go to the World Cup during my internship?",
    )
    by_id = {n.node_id: n.score for n in bundle.top_nodes}
    assert by_id["concept:belief:salmon"] < by_id["event:decision:d1"]
