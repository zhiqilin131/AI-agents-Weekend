"""Cross-option alignment checks and discrimination metrics for grounded MCDA."""

from __future__ import annotations

from foresight_x.decision.recommender import composite_score, evaluation_weights_for_risk_posture
from foresight_x.schemas import OptionEvaluation, UserState
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    AlignmentReport,
    AlignmentViolation,
    FeatureLevel,
    OptionFeatureVector,
)
from foresight_x.simulation.comparative_elicitation import comparative_to_scoring_clarification, feature_key_from_comparative_id
from foresight_x.simulation.missing_field_detector import COVERAGE_CLARIFY_THRESHOLD

DISCRIMINATION_MIN = 0.25
COMPOSITE_NEAR_DUPLICATE_EPSILON = 0.15

_LEVEL_NUM: dict[FeatureLevel, float] = {
    "low": 0.0,
    "medium": 1.0,
    "high": 2.0,
    "unknown": 1.0,
}


def _known_level(fv: OptionFeatureVector, key: str) -> FeatureLevel | None:
    st = (fv.field_status or {}).get(key, "unknown")
    val = getattr(fv, key, "unknown")
    if st == "known" and val in ("low", "medium", "high"):
        return val  # type: ignore[return-value]
    return None


def cross_option_discrimination(feature_vectors: list[OptionFeatureVector]) -> float:
    """Mean normalized spread of known feature levels across options (0..1)."""
    if len(feature_vectors) < 2:
        return 1.0
    spreads: list[float] = []
    for key in CRITICAL_FEATURE_KEYS:
        vals: list[float] = []
        for fv in feature_vectors:
            lv = _known_level(fv, key)
            if lv is not None:
                vals.append(_LEVEL_NUM[lv])
        if len(vals) < 2:
            continue
        spread = (max(vals) - min(vals)) / 2.0
        spreads.append(spread)
    if not spreads:
        return 0.0
    return sum(spreads) / len(spreads)


def _constraint_violations(user_state: UserState, fv: OptionFeatureVector) -> list[AlignmentViolation]:
    violations: list[AlignmentViolation] = []
    oid = fv.option_id
    stress = _known_level(fv, "stress_load_level")
    workload = _known_level(fv, "workload_level")
    time_c = _known_level(fv, "time_cost_level")

    if user_state.stress_level >= 8 and stress == "high":
        violations.append(
            AlignmentViolation(
                type="constraint_conflict",
                option_id=oid,
                feature_key="stress_load_level",
                user_constraint_ref="user_stress_level>=8",
                severity="warning",
                message="High-stress option while you reported elevated stress.",
            )
        )
    if user_state.workload >= 8 and workload == "high":
        violations.append(
            AlignmentViolation(
                type="constraint_conflict",
                option_id=oid,
                feature_key="workload_level",
                user_constraint_ref="user_workload>=8",
                severity="warning",
                message="Heavy workload option while you reported high current workload.",
            )
        )
    if user_state.time_pressure and str(user_state.time_pressure).lower().endswith("high") and time_c == "high":
        violations.append(
            AlignmentViolation(
                type="constraint_conflict",
                option_id=oid,
                feature_key="time_cost_level",
                user_constraint_ref="time_pressure=high",
                severity="warning",
                message="High time cost under high time pressure.",
            )
        )
    return violations


def _near_duplicate_options(evaluations: list[OptionEvaluation], risk_posture: str | None) -> bool:
    if len(evaluations) < 2:
        return False
    w = evaluation_weights_for_risk_posture(risk_posture)
    scores = [composite_score(e, w) for e in evaluations]
    if not scores:
        return False
    return (max(scores) - min(scores)) < COMPOSITE_NEAR_DUPLICATE_EPSILON


def needs_elicitation(
    coverage: float,
    feature_vectors: list[OptionFeatureVector],
    *,
    discrimination: float | None = None,
) -> bool:
    """True when coverage or cross-option discrimination is insufficient."""
    if coverage < COVERAGE_CLARIFY_THRESHOLD:
        if any(
            (fv.field_status or {}).get(k, "unknown") != "known"
            for fv in feature_vectors
            for k in CRITICAL_FEATURE_KEYS
        ):
            return True
    disc = discrimination if discrimination is not None else cross_option_discrimination(feature_vectors)
    if len(feature_vectors) >= 2 and disc < DISCRIMINATION_MIN:
        return True
    return False


def _tag_evidence_conflicts(
    tag_quality_reports: list | None,
) -> list[AlignmentViolation]:
    violations: list[AlignmentViolation] = []
    for report in tag_quality_reports or []:
        oid = getattr(report, "option_id", "") or (report.get("option_id") if isinstance(report, dict) else "")
        conflicts = getattr(report, "text_conflicts", None) or (
            report.get("text_conflicts") if isinstance(report, dict) else []
        )
        for raw in conflicts or []:
            text = str(raw)
            fkey = ""
            for key in CRITICAL_FEATURE_KEYS:
                if key in text:
                    fkey = key
                    break
            violations.append(
                AlignmentViolation(
                    type="tag_evidence_conflict",
                    option_id=str(oid),
                    feature_key=fkey,
                    severity="warning",
                    message=f"Option tags conflict with stated evidence: {text}",
                )
            )
    return violations


def _comparative_inconsistencies(
    existing_clarification: dict[str, str] | None,
    existing_comparative: dict[str, list[str]] | None,
) -> list[AlignmentViolation]:
    """Flag when rank-derived levels disagree with explicit per-option level answers."""
    if not existing_comparative or not existing_clarification:
        return []
    derived = comparative_to_scoring_clarification(existing_comparative)
    violations: list[AlignmentViolation] = []
    for qid, rank in existing_comparative.items():
        fkey = feature_key_from_comparative_id(qid) or ""
        for oid in rank:
            key = f"{oid}:{fkey}"
            if key not in existing_clarification or key not in derived:
                continue
            if existing_clarification[key] != derived[key]:
                violations.append(
                    AlignmentViolation(
                        type="comparative_inconsistent",
                        option_id=oid,
                        feature_key=fkey,
                        severity="warning",
                        message=(
                            f"Rank order implies {derived[key]} but you answered {existing_clarification[key]} "
                            f"for {fkey.replace('_level', '')}."
                        ),
                    )
                )
    return violations


def build_alignment_report(
    user_state: UserState,
    feature_vectors: list[OptionFeatureVector],
    evaluations: list[OptionEvaluation] | None = None,
    *,
    risk_posture: str | None = None,
    coverage: float = 0.0,
    tag_quality_reports: list | None = None,
    existing_clarification: dict[str, str] | None = None,
    existing_comparative: dict[str, list[str]] | None = None,
) -> AlignmentReport:
    disc = cross_option_discrimination(feature_vectors)
    violations: list[AlignmentViolation] = []
    for fv in feature_vectors:
        violations.extend(_constraint_violations(user_state, fv))
    violations.extend(_tag_evidence_conflicts(tag_quality_reports))
    violations.extend(
        _comparative_inconsistencies(existing_clarification, existing_comparative)
    )

    near_dup = _near_duplicate_options(evaluations or [], risk_posture)
    reconcile = any(v.type == "comparative_inconsistent" for v in violations) or near_dup
    clarity_ok = coverage >= COVERAGE_CLARIFY_THRESHOLD and disc >= DISCRIMINATION_MIN

    return AlignmentReport(
        cross_option_discrimination=round(disc, 3),
        constraint_violations=violations,
        near_duplicate_options=near_dup,
        clarity_test_passed=clarity_ok,
        reconcile_required=reconcile,
        coverage=coverage,
        needs_comparative_elicitation=len(feature_vectors) >= 2 and disc < DISCRIMINATION_MIN,
    )
