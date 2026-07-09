"""F0 MCDA / elicitation gate cases — $0."""

from __future__ import annotations

from foresight_x.schemas import Option, UserState
from foresight_x.simulation.alignment_engine import build_alignment_report, cross_option_discrimination
from foresight_x.simulation.comparative_elicitation import build_comparative_questions
from foresight_x.simulation.feature_schemas import FeatureAuditBundle, FeatureLevel, OptionFeatureVector, ScoringClarifyQuestion
from foresight_x.simulation.scoring_clarify_gate import (
    MAX_ELICITATION_ROUNDS,
    elicitation_round_count,
    should_pause_pipeline_for_scoring_clarify,
)

from tests.quality.metrics import compute_dgs


def _fv(oid: str, **levels: FeatureLevel) -> OptionFeatureVector:
    status = {k: "known" for k in levels}
    return OptionFeatureVector(option_id=oid, field_status=status, **levels)


def _opts() -> list[Option]:
    return [
        Option(option_id="a", name="Stay", description="", key_assumptions=[], cost_of_reversal="medium"),
        Option(option_id="b", name="Leave", description="", key_assumptions=[], cost_of_reversal="high"),
    ]


def test_m01_pause_when_coverage_low_and_questions_present() -> None:
    audit = FeatureAuditBundle(
        needs_scoring_clarification=True,
        grounded_feature_coverage=0.4,
        clarify_questions=[
            ScoringClarifyQuestion(id="q1", feature_key="stress_load_level", prompt="How stressful?")
        ],
    )
    assert should_pause_pipeline_for_scoring_clarify(audit, allow_provisional=False, elicitation_rounds=0)


def test_m02_no_pause_after_max_rounds() -> None:
    audit = FeatureAuditBundle(
        needs_scoring_clarification=True,
        grounded_feature_coverage=0.4,
        clarify_questions=[
            ScoringClarifyQuestion(id="q1", feature_key="stress_load_level", prompt="q")
        ],
    )
    assert not should_pause_pipeline_for_scoring_clarify(
        audit, allow_provisional=False, elicitation_rounds=MAX_ELICITATION_ROUNDS
    )


def test_m03_provisional_allowed_skips_pause() -> None:
    audit = FeatureAuditBundle(
        needs_scoring_clarification=True,
        grounded_feature_coverage=0.2,
        clarify_questions=[
            ScoringClarifyQuestion(id="q1", feature_key="stress_load_level", prompt="q")
        ],
    )
    assert not should_pause_pipeline_for_scoring_clarify(audit, allow_provisional=True)


def test_m04_comparative_questions_for_missing_features() -> None:
    fvs = [OptionFeatureVector(option_id="a"), OptionFeatureVector(option_id="b")]
    qs = build_comparative_questions(_opts(), fvs)
    assert isinstance(qs, list)


def test_m05_discrimination_detects_identical_options() -> None:
    fvs = [
        _fv("a", stress_load_level="medium", workload_level="medium", time_cost_level="medium"),
        _fv("b", stress_load_level="medium", workload_level="medium", time_cost_level="medium"),
    ]
    assert cross_option_discrimination(fvs) < 0.1


def test_m06_discrimination_high_when_features_differ() -> None:
    fvs = [
        _fv("a", stress_load_level="low", workload_level="low", time_cost_level="low"),
        _fv("b", stress_load_level="high", workload_level="high", time_cost_level="high"),
    ]
    assert cross_option_discrimination(fvs) >= 0.9


def test_m07_alignment_report_flags_high_stress_under_user_stress() -> None:
    us = UserState(
        raw_input="overwhelmed",
        goals=[],
        time_pressure="high",
        stress_level=9,
        workload=5,
        current_behavior="evaluating",
        decision_type="career",
        reversibility="partial",
    )
    fvs = [_fv("a", stress_load_level="high")]
    report = build_alignment_report(user_state=us, feature_vectors=fvs, evaluations=[])
    assert any(v.type == "constraint_conflict" for v in report.constraint_violations)


def test_m08_dgs_weighting_sane() -> None:
    perfect = compute_dgs(memory_score=1, graph_score=1, mcda_score=1, report_score=1, recommendation_score=1)
    weak = compute_dgs(memory_score=0, graph_score=0, mcda_score=0, report_score=0, recommendation_score=0)
    assert perfect == 1.0
    assert weak == 0.0
    mid = compute_dgs(memory_score=1, graph_score=0, mcda_score=1, report_score=1, recommendation_score=1)
    assert 0.5 < mid < 1.0


def test_m09_elicitation_round_count() -> None:
    assert elicitation_round_count([{"round": 1}, {"round": 2}]) == 2
    assert elicitation_round_count(None) == 0
