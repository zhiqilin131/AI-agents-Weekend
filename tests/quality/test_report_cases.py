"""F0 report integrity cases — $0."""

from __future__ import annotations

from foresight_x.decision.report_surface import _graph_influence_pattern_line, build_report_surface
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    GraphInfluenceBundle,
    InfluenceNode,
    MemoryBundle,
    NextAction,
    Option,
    OptionEvaluation,
    RationalityReport,
    Recommendation,
    Reflection,
    UserState,
)


def _trace(*, mem: MemoryBundle, us: UserState | None = None) -> DecisionTrace:
    return DecisionTrace(
        decision_id="quality-r",
        timestamp="2026-01-01T00:00:00Z",
        original_user_input=(us.raw_input if us else "test"),
        user_state=us
        or UserState(
            raw_input="test",
            goals=[],
            time_pressure="medium",
            stress_level=5,
            workload=5,
            current_behavior="evaluating",
            decision_type="personal",
            reversibility="partial",
        ),
        memory=mem,
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.5,
            recommended_slowdowns=[],
        ),
        options=[
            Option(
                option_id="o1",
                name="Stay",
                description="stay",
                key_assumptions=[],
                cost_of_reversal="medium",
            )
        ],
        futures=[],
        evaluations=[
            OptionEvaluation(
                option_id="o1",
                expected_value_score=7.0,
                risk_score=3.0,
                regret_score=2.0,
                uncertainty_score=4.0,
                goal_alignment_score=8.0,
                rationale="fits goals",
            )
        ],
        recommendation=Recommendation(
            chosen_option_id="o1",
            reasoning="Because boundaries matter.",
            next_actions=[NextAction(action="Write boundary message")],
            reassessment_triggers=["If ex escalates"],
        ),
        reflection=Reflection(
            possible_errors=[],
            uncertainty_sources=[],
            model_limitations=[],
            information_gaps=[],
            self_improvement_signal="",
        ),
    )


def test_r01_graph_line_prefers_current_influence() -> None:
    gi = GraphInfluenceBundle(
        algorithm="graphiti_hybrid_rrf_v1",
        top_nodes=[
            InfluenceNode(
                node_id="g1", label="ex-boyfriend", node_type="entity", layer="concept", score=1.0, why=""
            )
        ],
    )
    mem = MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=["Graph influence: Salmon (0.77)"],
        prior_outcomes_summary="",
        graph_influence=gi,
    )
    line = _graph_influence_pattern_line(mem)
    assert "ex-boyfriend" in line
    assert "Salmon" not in line


def test_r02_report_surface_has_primary_next_action() -> None:
    mem = MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary="")
    surf = build_report_surface(_trace(mem=mem))
    assert surf.primary_next_action.text
    assert surf.personalized_reasons is not None


def test_r03_grounding_note_without_history() -> None:
    mem = MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary="")
    surf = build_report_surface(_trace(mem=mem))
    assert "current context" in surf.grounding_note.lower()


def test_r04_personalized_fit_uses_graph_not_stale_pattern() -> None:
    gi = GraphInfluenceBundle(
        algorithm="graphiti_hybrid_rrf_v1",
        top_nodes=[
            InfluenceNode(node_id="g1", label="necklace", node_type="entity", layer="concept", score=0.9, why="")
        ],
    )
    mem = MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=["Graph influence: Salmon (0.77)"],
        prior_outcomes_summary="",
        graph_influence=gi,
    )
    surf = build_report_surface(_trace(mem=mem))
    if surf.personalized_reasons:
        reason0 = surf.personalized_reasons[0].text
        assert "Salmon" not in reason0
