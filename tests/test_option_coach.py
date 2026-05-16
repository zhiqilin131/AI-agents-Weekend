from __future__ import annotations

from foresight_x.chat.option_coach import build_option_chat_prompt
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    RationalityReport,
    Recommendation,
    Reflection,
    Reversibility,
    SimulatedFuture,
    Scenario,
    TimePressure,
    UserState,
)


def _user_state(raw: str = "Should I stay or leave?") -> UserState:
    return UserState(
        raw_input=raw,
        goals=["growth"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=4,
        workload=5,
        current_behavior="weighing options",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )


def _minimal_trace(*, options: list[Option] | None = None) -> DecisionTrace:
    opts = options or [
        Option(
            option_id="opt_a",
            name="Stay",
            description="Keep current role.",
            key_assumptions=["Boss stays supportive"],
            cost_of_reversal="low",
        ),
        Option(
            option_id="opt_b",
            name="Leave",
            description="Switch companies.",
            key_assumptions=["Market stays hot"],
            cost_of_reversal="high",
        ),
    ]
    return DecisionTrace(
        decision_id="d1",
        timestamp="2026-01-01T00:00:00Z",
        user_state=_user_state(),
        memory=MemoryBundle(
            behavioral_patterns=[],
            similar_past_decisions=[],
            prior_outcomes_summary="",
        ),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.8,
            recommended_slowdowns=[],
        ),
        options=opts,
        futures=[
            SimulatedFuture(
                option_id="opt_b",
                time_horizon="12 months",
                scenarios=[
                    Scenario(label="base", trajectory="Stable growth", probability=0.6, key_drivers=["skills"]),
                    Scenario(label="worst", trajectory="Regret", probability=0.4, key_drivers=["fit"]),
                ],
            )
        ],
        evaluations=[
            OptionEvaluation(
                option_id="opt_b",
                expected_value_score=7.5,
                risk_score=4.0,
                regret_score=3.0,
                uncertainty_score=5.0,
                goal_alignment_score=8.0,
                rationale="Strong alignment with goals.",
            )
        ],
        recommendation=Recommendation(
            chosen_option_id="opt_b",
            reasoning="Leave offers better upside.",
            next_actions=[],
            reassessment_triggers=[],
        ),
        reflection=Reflection(
            possible_errors=[],
            uncertainty_sources=[],
            model_limitations=[],
            information_gaps=[],
            self_improvement_signal="",
        ),
    )


def test_prompt_includes_option_name_description_and_evaluation() -> None:
    trace = _minimal_trace()
    option = trace.options[1]
    prompt = build_option_chat_prompt(
        trace,
        option,
        question="What do I say in the resignation meeting?",
        chat_history=[],
    )
    assert "Leave" in prompt
    assert "opt_b" in prompt
    assert "Switch companies" in prompt
    assert "Strong alignment with goals" in prompt
    assert "Stable growth" in prompt
    assert "resignation meeting" in prompt
    assert "Stay" in prompt  # other option name


def test_prompt_uses_client_context_when_trace_sparse() -> None:
    trace = _minimal_trace(
        options=[
            Option(
                option_id="opt_x",
                name="Freelance",
                description="",
                key_assumptions=[],
                cost_of_reversal="medium",
            )
        ]
    )
    option = trace.options[0]
    prompt = build_option_chat_prompt(
        trace,
        option,
        question="First week plan?",
        chat_history=[],
        client_context={
            "description": "Work independently with 2 anchor clients.",
            "key_assumptions": ["Clients renew"],
            "tradeoff_scores": {"EV": 8.0, "Risk": 6.0},
        },
    )
    assert "Work independently with 2 anchor clients" in prompt
    assert "Clients renew" in prompt
    assert "EV: 8.0" in prompt or "EV: 8" in prompt
