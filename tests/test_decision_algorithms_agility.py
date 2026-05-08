from foresight_x.decision_algorithms.agility import build_agility_preview
from foresight_x.decision_algorithms.influence_graph import build_influence_graph_from_trace
from foresight_x.decision_algorithms.mcda import evaluate_options_mcda
from foresight_x.decision_algorithms.robustness import evaluate_robustness, generate_consequence_scenarios
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    NextAction,
    Option,
    OptionEvaluation,
    RationalityReport,
    Recommendation,
    Reflection,
    Reversibility,
    TimePressure,
    UserState,
)


def _trace() -> DecisionTrace:
    return DecisionTrace(
        decision_id="d1",
        timestamp="2026-05-08T00:00:00Z",
        user_state=UserState(
            raw_input="Which path should I choose?",
            goals=["progress"],
            time_pressure=TimePressure.MEDIUM,
            stress_level=5,
            workload=6,
            current_behavior="deliberating",
            decision_type="career",
            reversibility=Reversibility.PARTIAL,
        ),
        memory=MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary=""),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=["planning fallacy"],
            confidence=0.7,
            recommended_slowdowns=[],
        ),
        options=[
            Option(option_id="option_1", name="Option 1", description="A", key_assumptions=["x"], cost_of_reversal="low"),
            Option(option_id="option_2", name="Option 2", description="B", key_assumptions=["y"], cost_of_reversal="high"),
        ],
        futures=[],
        evaluations=[
            OptionEvaluation(
                option_id="option_1",
                expected_value_score=7,
                risk_score=4,
                regret_score=4,
                uncertainty_score=5,
                goal_alignment_score=8,
                rationale="ok",
            )
        ],
        recommendation=Recommendation(
            chosen_option_id="option_1",
            reasoning="Option 1 fits priorities.",
            next_actions=[NextAction(action="Draft plan", deadline="Tomorrow")],
            reassessment_triggers=["major delay"],
        ),
        reflection=Reflection(
            possible_errors=[],
            uncertainty_sources=[],
            model_limitations=[],
            information_gaps=[],
            self_improvement_signal="",
        ),
    )


def test_agility_preview_has_required_fields_no_probability():
    trace = _trace()
    graph = build_influence_graph_from_trace(trace)
    mcda = evaluate_options_mcda(graph.options)
    opt = graph.options[0]
    scenarios = generate_consequence_scenarios(opt, graph)
    robust = evaluate_robustness(opt, scenarios, mcda)
    preview = build_agility_preview(opt.id, graph, mcda, robust, trace)
    out = preview.model_dump(mode="json")
    assert "likely_consequences" in out
    assert "risk_windows" in out
    assert "first_steps" in out
    assert "review_checkpoint" in out
    assert "probability" not in out

