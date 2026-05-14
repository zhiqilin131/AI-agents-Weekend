from __future__ import annotations

from foresight_x.orchestration.pipeline import _rank_graph_nodes_for_display
from foresight_x.schemas import GraphInfluenceBundle, InfluenceNode, UserState


def test_rank_graph_nodes_for_display_prioritizes_decision_then_on_topic_concept() -> None:
    user_state = UserState(
        raw_input="Should I go to the World Cup or focus on my internship?",
        goals=[],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type="career",
        reversibility="partial",
    )
    influence = GraphInfluenceBundle(
        top_nodes=[
            InfluenceNode(
                node_id="concept:belief:salmon",
                label="user hates raw salmon fish",
                node_type="belief",
                layer="concept",
                score=0.7,
                why="test",
            ),
            InfluenceNode(
                node_id="concept:value:world_cup",
                label="considering attending the World Cup",
                node_type="value",
                layer="concept",
                score=0.5,
                why="test",
            ),
            InfluenceNode(
                node_id="event:decision:d1",
                label="Decision d1 (career)",
                node_type="decision",
                layer="event",
                score=0.4,
                why="test",
            ),
        ]
    )
    out = _rank_graph_nodes_for_display(influence, user_state)
    assert out[0].node_id.startswith("event:decision:")
    assert out[1].node_id == "concept:value:world_cup"
    assert out[2].node_id == "concept:belief:salmon"
