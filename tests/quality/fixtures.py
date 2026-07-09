"""Deterministic, hand-built DecisionTrace fixtures for offline scoring-engine tests.

Unlike ``tests/quality/reports/traces/...`` (real LLM output from a prior paid
run, gitignored and therefore ABSENT on a fresh clone / CI), these fixtures are
committed to the repo and constructed directly from the pydantic schemas, so
the regression tests in ``test_e2e_scoring.py`` always run — they never
silently skip for lack of a prior paid run. $0, no API calls.
"""

from __future__ import annotations

from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    GraphInfluenceBundle,
    InfluenceNode,
    MemoryBundle,
    NextAction,
    Option,
    PastDecision,
    RationalityReport,
    Recommendation,
    Reflection,
    UserState,
)

_USER_STATE = UserState(
    raw_input=(
        "A startup gave me until Friday to decide. My manager countered with a retention "
        "bonus and one remote day per week. How should I compare the packages honestly?"
    ),
    active_user_id="quality_fict_jordan_28",
    goals=["compare total compensation", "protect evenings"],
    time_pressure="high",
    stress_level=6,
    workload=6,
    current_behavior="evaluating",
    decision_type="career",
    reversibility="partial",
)

_CLEAN_MEMORY_PATTERNS = ["Retrieval themes: career, compensation"]

_CLEAN_GRAPH_NODES = [
    InfluenceNode(
        node_id="graphiti:1",
        label="retention bonus",
        node_type="entity",
        layer="concept",
        score=0.8,
        why="Matches current counter-offer negotiation.",
    ),
    InfluenceNode(
        node_id="graphiti:2",
        label="startup offer",
        node_type="entity",
        layer="concept",
        score=0.6,
        why="Prior comparable decision.",
    ),
]

_OPTIONS = [
    Option(
        option_id="opt_stay",
        name="Stay with retention package",
        description="Accept the counter-offer: retention bonus plus one remote day per week.",
        key_assumptions=["Bonus is paid in full", "Remote day is honored long-term"],
        cost_of_reversal="medium",
    ),
    Option(
        option_id="opt_leave",
        name="Accept the startup offer",
        description="Leave for the startup by Friday's deadline.",
        key_assumptions=["Startup funding is stable", "Equity has real upside"],
        cost_of_reversal="high",
    ),
]

_COMPLETE_RECOMMENDATION = Recommendation(
    chosen_option_id="opt_stay",
    reasoning="Retention package matches total compensation with lower reversal cost.",
    next_actions=[NextAction(action="Get the retention terms in writing", deadline="2026-01-10")],
    reassessment_triggers=["Startup offer is re-extended after 6 months"],
)

_EMPTY_RECOMMENDATION = Recommendation(
    chosen_option_id="",
    reasoning="",
    next_actions=[],
    reassessment_triggers=[],
)


def _base_trace(
    *,
    decision_id: str,
    memory: MemoryBundle,
    recommendation: Recommendation,
    options: list[Option] | None = None,
) -> DecisionTrace:
    return DecisionTrace(
        decision_id=decision_id,
        timestamp="2026-01-05T12:00:00Z",
        original_user_input=_USER_STATE.raw_input,
        user_state=_USER_STATE,
        memory=memory,
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.7,
            recommended_slowdowns=[],
        ),
        options=options if options is not None else list(_OPTIONS),
        futures=[],
        evaluations=[],
        recommendation=recommendation,
        reflection=Reflection(
            possible_errors=[],
            uncertainty_sources=[],
            model_limitations=[],
            information_gaps=[],
            self_improvement_signal="",
        ),
        feature_audit={"grounded_feature_coverage": 0.8, "cross_option_discrimination": 0.6},
        scoring_elicitation_rounds=[{"round": 1}],
    )


def good_career_trace() -> DecisionTrace:
    """Everything a `fict-career-01-counter-offer-deadline` run should look like when
    memory, graph, options and recommendation all work correctly."""
    memory = MemoryBundle(
        similar_past_decisions=[
            PastDecision(
                decision_id="pd_jordan_002",
                situation_summary="Employer countered a competing offer with retention bonus tied to two-year stay.",
                chosen_option="Accepted retention bonus with written remote-day clause.",
                outcome="Stayed two years; bonus helped with mortgage.",
                timestamp="2024-08-20T14:00:00Z",
            )
        ],
        behavioral_patterns=list(_CLEAN_MEMORY_PATTERNS),
        prior_outcomes_summary="Past retention-bonus decisions worked out well.",
        graph_influence=GraphInfluenceBundle(
            algorithm="graphiti_hybrid_rrf_v1",
            top_nodes=list(_CLEAN_GRAPH_NODES),
            seed_nodes=[],
            surfaced_decision_ids=["pd_jordan_002"],
            notes=["fixture"],
        ),
    )
    return _base_trace(
        decision_id="fixture-good-career-01",
        memory=memory,
        recommendation=_COMPLETE_RECOMMENDATION,
    )


def graph_leak_trace() -> DecisionTrace:
    """Same as good_career_trace but the graph surfaced a blocklisted node in the
    top-4 — must tank the graph component score without touching anything else."""
    memory = MemoryBundle(
        similar_past_decisions=[
            PastDecision(
                decision_id="pd_jordan_002",
                situation_summary="Employer countered a competing offer with retention bonus tied to two-year stay.",
                chosen_option="Accepted retention bonus with written remote-day clause.",
                outcome="Stayed two years; bonus helped with mortgage.",
                timestamp="2024-08-20T14:00:00Z",
            )
        ],
        behavioral_patterns=list(_CLEAN_MEMORY_PATTERNS),
        prior_outcomes_summary="Past retention-bonus decisions worked out well.",
        graph_influence=GraphInfluenceBundle(
            algorithm="graphiti_hybrid_rrf_v1",
            top_nodes=[
                InfluenceNode(
                    node_id="graphiti:leak",
                    label="Salmon dinner",
                    node_type="entity",
                    layer="concept",
                    score=0.95,
                    why="Spurious high score from an unrelated episode.",
                ),
                *_CLEAN_GRAPH_NODES,
            ],
            seed_nodes=[],
            surfaced_decision_ids=["pd_jordan_002"],
            notes=["fixture: deliberate blocklist leak"],
        ),
    )
    return _base_trace(
        decision_id="fixture-graph-leak-career-01",
        memory=memory,
        recommendation=_COMPLETE_RECOMMENDATION,
    )


def missing_recommendation_trace() -> DecisionTrace:
    """Decision-category trace where the recommendation never materialized —
    must score near-zero on the recommendation component regardless of how
    well memory/graph/options scored."""
    memory = MemoryBundle(
        similar_past_decisions=[
            PastDecision(
                decision_id="pd_jordan_002",
                situation_summary="Employer countered a competing offer with retention bonus tied to two-year stay.",
                chosen_option="Accepted retention bonus with written remote-day clause.",
                outcome="Stayed two years; bonus helped with mortgage.",
                timestamp="2024-08-20T14:00:00Z",
            )
        ],
        behavioral_patterns=list(_CLEAN_MEMORY_PATTERNS),
        prior_outcomes_summary="",
        graph_influence=GraphInfluenceBundle(
            algorithm="graphiti_hybrid_rrf_v1",
            top_nodes=list(_CLEAN_GRAPH_NODES),
            seed_nodes=[],
            surfaced_decision_ids=["pd_jordan_002"],
            notes=["fixture"],
        ),
    )
    return _base_trace(
        decision_id="fixture-missing-recommendation-career-01",
        memory=memory,
        recommendation=_EMPTY_RECOMMENDATION,
    )
