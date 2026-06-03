"""Tests for P0–P2 MCDA rigor improvements."""

from __future__ import annotations

from foresight_x.decision.weight_audit import build_weight_audit, composite_map
from foresight_x.schemas import (
    EvidenceBundle,
    Option,
    OptionEvaluation,
    OptionTradeoffTags,
    Reversibility,
    TimePressure,
    UserState,
)
from foresight_x.simulation.clarify_voi import rank_questions_by_voi
from foresight_x.simulation.feature_extractor import extract_option_features
from foresight_x.simulation.feature_merge import resolve_feature
from foresight_x.simulation.feature_schemas import OptionFeatureVector, ScoringClarifyQuestion
from foresight_x.simulation.feature_scorer import score_options_from_features
from foresight_x.simulation.goal_achievement import assess_structured_goal_alignment
from foresight_x.simulation.missing_field_detector import build_clarify_questions
from foresight_x.simulation.tag_quality_audit import audit_option_tags


def _user(**kwargs) -> UserState:
    base = dict(
        raw_input="career choice",
        goals=["career growth", "work-life balance"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="thinking",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    base.update(kwargs)
    return UserState(**base)


def test_rule_proxy_features_are_candidate_not_known() -> None:
    opt = Option(
        option_id="a",
        name="Quit",
        description="Leave job",
        key_assumptions=[],
        cost_of_reversal="high",
    )
    rev = resolve_feature(
        "reversibility_level",
        option=opt,
        rule_level="low",
        rule_confidence=0.85,
    )
    assert rev.status == "candidate"
    assert rev.level == "low"


def test_tag_conflict_downgrades_to_candidate() -> None:
    opt = Option(
        option_id="a",
        name="Sprint",
        description="All-in sprint with intense overtime",
        key_assumptions=[],
        cost_of_reversal="high",
        tradeoff_tags=OptionTradeoffTags(
            stress_load_level="low",
            tag_confidence=0.9,
            tag_source="llm_tagging",
        ),
    )
    report = audit_option_tags(opt, EvidenceBundle(facts=[], base_rates=[], recent_events=[]))
    assert not report.passes_quality_gate
    assert report.text_conflicts
    resolved = resolve_feature(
        "stress_load_level",
        option=opt,
        tag_level="low",
        tag_quality_passes=report.passes_quality_gate,
    )
    assert resolved.status == "candidate"


def test_structured_goal_achievement_known_for_career_theme() -> None:
    opt_blob = "Accept remote role with growth upside and promotion path"
    features = {
        "upside_potential_level": "high",
        "time_cost_level": "medium",
        "stress_load_level": "low",
        "workload_level": "medium",
        "money_cost_level": "medium",
        "downside_severity_level": "low",
    }
    g1 = assess_structured_goal_alignment(opt_blob, _user(), features)
    assert g1 is not None
    assert g1.status == "known"
    assert g1.level in ("medium", "high")


def test_voi_ranks_upside_before_obscure_field() -> None:
    known = {k: "known" for k in (
        "time_cost_level", "money_cost_level", "stress_load_level", "workload_level",
        "reversibility_level", "downside_severity_level", "goal_alignment_level",
    )}
    fvs = [
        OptionFeatureVector(
            option_id="a",
            upside_potential_level="unknown",
            field_status={**known, "upside_potential_level": "unknown"},
        ),
        OptionFeatureVector(
            option_id="b",
            upside_potential_level="high",
            field_status={**known, "upside_potential_level": "known"},
        ),
    ]
    qs = [
        ScoringClarifyQuestion(
            id="a:upside_potential_level",
            feature_key="upside_potential_level",
            option_id="a",
            prompt="Upside?",
        ),
        ScoringClarifyQuestion(
            id="b:reversibility_level",
            feature_key="reversibility_level",
            option_id="b",
            prompt="Rev?",
        ),
    ]
    evals = [
        OptionEvaluation(
            option_id="a",
            expected_value_score=4.0,
            risk_score=5.0,
            regret_score=5.0,
            uncertainty_score=8.0,
            goal_alignment_score=5.0,
            rationale="",
        ),
        OptionEvaluation(
            option_id="b",
            expected_value_score=6.0,
            risk_score=5.0,
            regret_score=5.0,
            uncertainty_score=5.0,
            goal_alignment_score=5.0,
            rationale="",
        ),
    ]
    ranked = rank_questions_by_voi(qs, fvs, evals)
    assert ranked[0].feature_key == "upside_potential_level"


def test_relative_uncertainty_differentiates_sparse_options() -> None:
    sparse = OptionFeatureVector(option_id="a", missing_critical_info_count=6)
    less_sparse = OptionFeatureVector(
        option_id="b",
        missing_critical_info_count=2,
        time_cost_level="medium",
        field_status={"time_cost_level": "known"},
    )
    evals = score_options_from_features([sparse, less_sparse], relative_uncertainty=True)
    assert evals[0].uncertainty_score > evals[1].uncertainty_score
    assert evals[0].uncertainty_score < 10.0 or evals[1].uncertainty_score < evals[0].uncertainty_score


def test_weight_audit_flags_fragile_ranking() -> None:
    evals = [
        OptionEvaluation(
            option_id="a",
            expected_value_score=10.0,
            risk_score=5.0,
            regret_score=5.0,
            uncertainty_score=5.0,
            goal_alignment_score=1.0,
            rationale="",
        ),
        OptionEvaluation(
            option_id="b",
            expected_value_score=1.0,
            risk_score=5.0,
            regret_score=5.0,
            uncertainty_score=5.0,
            goal_alignment_score=10.0,
            rationale="",
        ),
    ]
    comp, w = composite_map(evals)
    audit = build_weight_audit(
        evals,
        composite_by_option_id=comp,
        winner_id="a",
        risk_posture="moderate",
        applied_weights=w,
    )
    assert audit["winner_margin"] < 0.01
    assert len(audit["fragile_criteria"]) >= 1
