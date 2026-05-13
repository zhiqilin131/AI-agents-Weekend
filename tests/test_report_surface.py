"""report_surface derivation from DecisionTrace."""

from __future__ import annotations

from foresight_x.decision.report_surface import build_report_surface, _has_history_memory
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    Fact,
    MemoryBundle,
    NextAction,
    Option,
    OptionEvaluation,
    PastDecision,
    RationalityReport,
    Recommendation,
    Reflection,
    Scenario,
    SimulatedFuture,
    UserState,
)


def _minimal_user_state(**kwargs: object) -> UserState:
    base = dict(
        raw_input="Should I take the offer or wait?",
        goals=["stability"],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type="career",
        reversibility="partial",
    )
    base.update(kwargs)
    return UserState.model_validate(base)


def test_grounding_note_without_history() -> None:
    us = _minimal_user_state()
    mem = MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=[],
        prior_outcomes_summary="",
    )
    trace = _make_trace(mem=mem, us=us)
    surf = build_report_surface(trace)
    assert "Based mostly on current context" in surf.grounding_note
    assert surf.grounding_strength in {"mixed", "thin"}
    assert {s.type for s in surf.grounding_signals} >= {"user_context", "personal_memory", "external_evidence"}
    assert not _has_history_memory(trace)


def test_grounding_note_with_similar_past() -> None:
    us = _minimal_user_state()
    mem = MemoryBundle(
        similar_past_decisions=[
            PastDecision(
                decision_id="d1",
                situation_summary="Earlier role tradeoff",
                chosen_option="wait",
                timestamp="2024-01-01",
            )
        ],
        behavioral_patterns=[],
        prior_outcomes_summary="",
    )
    trace = _make_trace(mem=mem, us=us)
    assert _has_history_memory(trace)
    surf = build_report_surface(trace)
    assert "memories" in surf.grounding_note.lower()
    assert surf.grounding_signals


def test_future_paths_three_kinds() -> None:
    trace = _trace_with_futures()
    surf = build_report_surface(trace)
    kinds = {p.path_type for p in surf.future_paths}
    assert kinds == {"expected", "friction", "pivot"}
    for p in surf.future_paths:
        assert p.summary
        assert p.trigger_conditions
        assert p.watch_signals
        assert p.recommended_action
        assert p.based_on


def _make_trace(mem: MemoryBundle, us: UserState) -> DecisionTrace:
    opt = Option(
        option_id="o1",
        name="Take offer",
        description="Accept now",
        key_assumptions=["Employer intent stays stable"],
        cost_of_reversal="medium",
    )
    fut = SimulatedFuture(
        option_id="o1",
        time_horizon="6 months",
        scenarios=[
            Scenario(
                label="base",
                trajectory="Role lands as discussed with modest ramp-up.",
                probability=0.5,
                key_drivers=["onboarding capacity"],
            ),
            Scenario(
                label="worst",
                trajectory="Scope creep and burnout risk.",
                probability=0.25,
                key_drivers=["weak boundaries"],
            ),
            Scenario(
                label="best",
                trajectory="Strong mentor support accelerates growth.",
                probability=0.25,
                key_drivers=["team quality"],
            ),
        ],
    )
    ev = OptionEvaluation(
        option_id="o1",
        expected_value_score=7.0,
        risk_score=4.0,
        regret_score=3.0,
        uncertainty_score=5.0,
        goal_alignment_score=8.0,
        rationale="Balances upside with manageable regret.",
    )
    rec = Recommendation(
        chosen_option_id="o1",
        reasoning="Best fit given constraints.",
        next_actions=[NextAction(action="Schedule a 30-minute prep block", deadline="Friday")],
        reassessment_triggers=[],
    )
    refl = Reflection(
        possible_errors=["Overconfidence"],
        uncertainty_sources=["Market shifts"],
        model_limitations=["Static snapshot"],
        information_gaps=["Counter-off terms"],
        self_improvement_signal="ok",
    )
    return DecisionTrace(
        decision_id="test-decision",
        timestamp="2026-01-01T00:00:00Z",
        original_user_input=us.raw_input,
        user_state=us,
        memory=mem,
        evidence=EvidenceBundle(facts=[Fact(text="Sector hiring steady", confidence=0.5)], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.8,
            recommended_slowdowns=[],
        ),
        options=[opt],
        futures=[fut],
        evaluations=[ev],
        recommendation=rec,
        reflection=refl,
    )


def _trace_with_futures() -> DecisionTrace:
    us = _minimal_user_state()
    mem = MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=["Tends to defer hard deadlines"],
        prior_outcomes_summary="",
    )
    return _make_trace(mem=mem, us=us)
