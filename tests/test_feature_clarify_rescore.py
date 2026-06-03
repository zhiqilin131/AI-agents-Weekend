"""Tests for feature merge, clarify, and rescore paths."""

from __future__ import annotations

from foresight_x.orchestration.rescore import rescore_trace
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    OptionTradeoffTags,
    RationalityReport,
    Recommendation,
    Reflection,
    Reversibility,
    TimePressure,
    UserState,
)
from foresight_x.simulation.feature_confirmation import apply_scoring_clarification_to_options
from foresight_x.simulation.feature_extractor import extract_option_features
from foresight_x.simulation.feature_merge import grounded_coverage, level_from_clarify_answer
from foresight_x.simulation.feature_schemas import FeatureAuditBundle, OptionFeatureVector
from foresight_x.simulation.missing_field_detector import build_clarify_questions, enrich_audit_bundle


def _option(oid: str = "a") -> Option:
    return Option(
        option_id=oid,
        name="Option A",
        description="Test option",
        key_assumptions=[],
        cost_of_reversal="medium",
    )


def test_level_from_clarify_answer_maps_levels() -> None:
    assert level_from_clarify_answer("high") == "high"
    assert level_from_clarify_answer("not sure") is None


def test_scoring_clarification_merges_into_tags() -> None:
    opts = apply_scoring_clarification_to_options(
        [_option("a")],
        {"a:money_cost_level": "high"},
    )
    tags = opts[0].tradeoff_tags
    assert tags is not None
    assert tags.money_cost_level == "high"
    assert tags.tag_source == "user"


def test_build_clarify_questions_for_unknown_features() -> None:
    fv = OptionFeatureVector(
        option_id="a",
        field_status={
            "time_cost_level": "known",
            "money_cost_level": "unknown",
            "stress_load_level": "known",
            "workload_level": "known",
            "reversibility_level": "known",
            "downside_severity_level": "known",
            "upside_potential_level": "known",
            "goal_alignment_level": "known",
        },
    )
    qs = build_clarify_questions([fv], {"a": "Option A"})
    assert qs
    assert qs[0].id == "a:money_cost_level"
    assert "money" in qs[0].prompt.lower()


def test_enrich_audit_bundle_flags_low_coverage() -> None:
    fv = OptionFeatureVector(option_id="a", field_status={"money_cost_level": "unknown"})
    audit = enrich_audit_bundle(
        FeatureAuditBundle(feature_vectors=[fv], reliability_reports=[], candidates=[]),
        {"a": "Option A"},
    )
    assert audit.needs_scoring_clarification
    assert audit.clarify_questions


def _user_state(raw: str = "pick between options") -> UserState:
    return UserState(
        raw_input=raw,
        goals=["test goal"],
        time_pressure=TimePressure.LOW,
        stress_level=5,
        workload=5,
        current_behavior="thinking",
        decision_type="test",
        reversibility=Reversibility.PARTIAL,
    )


def test_rescore_trace_applies_clarification() -> None:
    trace = DecisionTrace(
        decision_id="test-rescore",
        timestamp="2026-01-01T00:00:00Z",
        user_state=_user_state(),
        memory=MemoryBundle(
            similar_past_decisions=[],
            behavioral_patterns=[],
            prior_outcomes_summary="",
        ),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        options=[
            Option(
                option_id="a",
                name="A",
                description="Cheap path",
                key_assumptions=[],
                cost_of_reversal="low",
            ),
            Option(
                option_id="b",
                name="B",
                description="Expensive path",
                key_assumptions=[],
                cost_of_reversal="medium",
            ),
        ],
        futures=[],
        evaluations=[
            OptionEvaluation(
                option_id="a",
                expected_value_score=5.0,
                risk_score=5.0,
                regret_score=5.0,
                uncertainty_score=5.0,
                goal_alignment_score=5.0,
                rationale="placeholder",
            )
        ],
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.8,
            recommended_slowdowns=[],
        ),
        recommendation=Recommendation(
            chosen_option_id="a",
            reasoning="placeholder",
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
    updated = rescore_trace(
        trace,
        scoring_clarification={"b:money_cost_level": "high", "a:money_cost_level": "low"},
        llm=None,
        persist_trace=False,
    )
    assert updated.feature_audit is not None
    assert updated.scoring_clarification is not None
    assert updated.evaluations
    b_tags = next(o for o in updated.options if o.option_id == "b").tradeoff_tags
    assert b_tags is not None
    assert b_tags.money_cost_level == "high"


def test_grounded_coverage_increases_with_known_tags() -> None:
    tagged = _option("a").model_copy(
        update={
            "tradeoff_tags": OptionTradeoffTags(
                money_cost_level="low",
                stress_load_level="low",
                workload_level="low",
                time_cost_level="low",
                upside_potential_level="medium",
                downside_severity_level="low",
                goal_alignment_level="medium",
                tag_confidence=0.9,
            )
        }
    )
    fv = extract_option_features(
        tagged,
        _user_state("x"),
        EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
    )
    assert grounded_coverage([fv]) >= 0.5
