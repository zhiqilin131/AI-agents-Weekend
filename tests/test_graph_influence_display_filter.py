from __future__ import annotations

from foresight_x.orchestration.pipeline import _rank_graph_nodes_for_display
from foresight_x.schemas import GraphInfluenceBundle, InfluenceNode, UserState


def _user_state() -> UserState:
    return UserState(
        raw_input="Should I go to the World Cup or focus on my internship?",
        goals=[],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type="career",
        reversibility="partial",
    )


def test_rank_graph_nodes_for_display_prioritizes_decision_then_on_topic_concept() -> None:
    """Off-topic nodes (no token overlap, not a surfaced decision event) are dropped
    from the displayed set entirely once at least one relevant node is present —
    a high raw retrieval score alone must never surface irrelevant content."""
    influence = GraphInfluenceBundle(
        top_nodes=[
            InfluenceNode(
                node_id="concept:belief:salmon",
                label="user hates raw salmon fish",
                node_type="belief",
                layer="concept",
                score=0.99,  # deliberately higher than the relevant nodes below
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
    out = _rank_graph_nodes_for_display(influence, _user_state())
    assert [n.node_id for n in out] == ["event:decision:d1", "concept:value:world_cup"]


def test_rank_graph_nodes_for_display_falls_back_to_raw_score_when_nothing_relevant() -> None:
    """Cold-start graph: no node shares any theme token and none is a surfaced
    decision event. Showing something (best-effort, raw-score order) beats
    showing nothing, since there is no relevance signal to filter by."""
    influence = GraphInfluenceBundle(
        top_nodes=[
            InfluenceNode(
                node_id="concept:belief:salmon",
                label="user hates raw salmon fish",
                node_type="belief",
                layer="concept",
                score=0.3,
                why="test",
            ),
            InfluenceNode(
                node_id="concept:belief:coffee",
                label="user prefers decaf coffee",
                node_type="belief",
                layer="concept",
                score=0.6,
                why="test",
            ),
        ]
    )
    out = _rank_graph_nodes_for_display(influence, _user_state())
    assert [n.node_id for n in out] == ["concept:belief:coffee", "concept:belief:salmon"]
