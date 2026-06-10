"""Tests for pre-recommendation scoring clarify gate."""

from __future__ import annotations

from foresight_x.simulation.feature_schemas import FeatureAuditBundle, OptionFeatureVector
from foresight_x.simulation.missing_field_detector import enrich_audit_bundle
from foresight_x.simulation.scoring_clarify_gate import (
    MAX_ELICITATION_ROUNDS,
    recommendation_is_provisional,
    scoring_clarification_attempted,
    should_pause_pipeline_for_scoring_clarify,
)


def _low_coverage_audit() -> FeatureAuditBundle:
    fv = OptionFeatureVector(option_id="a", field_status={"money_cost_level": "unknown"})
    return enrich_audit_bundle(
        FeatureAuditBundle(feature_vectors=[fv], reliability_reports=[], candidates=[]),
        {"a": "Option A"},
    )


def test_pause_when_coverage_low_and_no_answers() -> None:
    audit = _low_coverage_audit()
    assert audit.needs_scoring_clarification
    assert should_pause_pipeline_for_scoring_clarify(
        audit,
        allow_provisional=False,
        scoring_clarification_skip=False,
        elicitation_rounds=0,
    )


def test_no_pause_after_user_skip() -> None:
    audit = _low_coverage_audit()
    assert not should_pause_pipeline_for_scoring_clarify(
        audit,
        allow_provisional=False,
        scoring_clarification_skip=True,
        elicitation_rounds=0,
    )


def test_re_pause_when_still_insufficient_under_round_cap() -> None:
    audit = _low_coverage_audit()
    assert should_pause_pipeline_for_scoring_clarify(
        audit,
        allow_provisional=False,
        scoring_clarification_skip=False,
        elicitation_rounds=1,
    )


def test_no_pause_when_max_rounds_reached() -> None:
    audit = _low_coverage_audit()
    assert not should_pause_pipeline_for_scoring_clarify(
        audit,
        allow_provisional=False,
        scoring_clarification_skip=False,
        elicitation_rounds=MAX_ELICITATION_ROUNDS,
    )


def test_provisional_flag_on_skip() -> None:
    audit = _low_coverage_audit()
    assert recommendation_is_provisional(
        audit,
        allow_provisional=True,
        clarification_attempted=True,
    )


def test_not_provisional_when_grounded() -> None:
    fv = OptionFeatureVector(
        option_id="a",
        field_status={
            "time_cost_level": "known",
            "money_cost_level": "known",
            "stress_load_level": "known",
            "workload_level": "known",
            "reversibility_level": "known",
            "downside_severity_level": "known",
            "upside_potential_level": "known",
            "goal_alignment_level": "known",
        },
    )
    audit = enrich_audit_bundle(
        FeatureAuditBundle(feature_vectors=[fv], reliability_reports=[], candidates=[]),
        {"a": "Option A"},
    )
    assert not audit.needs_scoring_clarification
    assert not recommendation_is_provisional(
        audit,
        allow_provisional=True,
        clarification_attempted=False,
    )


def test_scoring_clarification_attempted_detects_resume() -> None:
    assert scoring_clarification_attempted("evaluate", {"a:money_cost_level": "high"}, False)
    assert scoring_clarification_attempted("evaluate", None, True)
    assert not scoring_clarification_attempted(None, None, False)
