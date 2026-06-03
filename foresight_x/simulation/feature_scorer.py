"""Deterministic MCDA-compatible scores from OptionFeatureVector."""

from __future__ import annotations

from foresight_x.schemas import OptionEvaluation
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    FeatureLevel,
    FeatureStatus,
    FutureReliabilityReport,
    OptionFeatureVector,
)

# Unknown levels use conservative neutrals — neither optimistic nor alarmist by default.
RISK_LIKE: dict[FeatureLevel, float] = {
    "low": 0.25,
    "medium": 0.55,
    "high": 0.85,
    "unknown": 0.60,
}
BENEFIT_LIKE: dict[FeatureLevel, float] = {
    "low": 0.25,
    "medium": 0.55,
    "high": 0.85,
    "unknown": 0.40,
}

COVERAGE_UNCERTAINTY_THRESHOLD = 0.55


def _clamp_score(value: float) -> float:
    return max(0.0, min(10.0, value))


def _reversibility_as_risk(reversibility: FeatureLevel) -> FeatureLevel:
    """Map reversibility (benefit-like) to risk contribution."""
    if reversibility == "low":
        return "high"
    if reversibility == "high":
        return "low"
    if reversibility == "medium":
        return "medium"
    return "unknown"


def _level_value(level: FeatureLevel, *, benefit: bool, status: FeatureStatus) -> float:
    if status == "unknown" or level == "unknown":
        return BENEFIT_LIKE["unknown"] if benefit else RISK_LIKE["unknown"]
    if status == "candidate":
        base = BENEFIT_LIKE[level] if benefit else RISK_LIKE[level]
        neutral = BENEFIT_LIKE["unknown"] if benefit else RISK_LIKE["unknown"]
        return base * 0.85 + neutral * 0.15
    return BENEFIT_LIKE[level] if benefit else RISK_LIKE[level]


def _avg_risk_levels(levels: list[FeatureLevel], statuses: list[FeatureStatus]) -> float:
    if not levels:
        return RISK_LIKE["unknown"]
    vals = [_level_value(l, benefit=False, status=s) for l, s in zip(levels, statuses)]
    return sum(vals) / len(vals)


def _provenance_coverage(fv: OptionFeatureVector) -> float:
    if not fv.provenance:
        return 0.0
    keys = {p.feature_key for p in fv.provenance}
    return len(keys) / max(1, len(set(CRITICAL_FEATURE_KEYS)))


def _status_for(fv: OptionFeatureVector, key: str) -> FeatureStatus:
    st = (fv.field_status or {}).get(key, "unknown")
    if st in ("known", "candidate", "unknown"):
        return st  # type: ignore[return-value]
    return "unknown"


def _build_rationale(
    fv: OptionFeatureVector,
    *,
    futures_uncertainty_bump: float = 0.0,
    coverage: float = 0.0,
) -> str:
    parts = [
        "Deterministic feature-based scores:",
        f"upside={fv.upside_potential_level}({_status_for(fv, 'upside_potential_level')})",
        f"goal_align={fv.goal_alignment_level}({_status_for(fv, 'goal_alignment_level')})",
        f"downside={fv.downside_severity_level}({_status_for(fv, 'downside_severity_level')})",
        f"reversibility={fv.reversibility_level}",
        f"stress={fv.stress_load_level}({_status_for(fv, 'stress_load_level')})",
        f"workload={fv.workload_level}({_status_for(fv, 'workload_level')})",
        f"option_coverage={coverage:.0%}",
    ]
    if fv.hard_constraint_violations:
        parts.append(f"constraint_flags={','.join(fv.hard_constraint_violations[:3])}")
    if fv.missing_critical_info_count:
        parts.append(f"missing_critical={fv.missing_critical_info_count}")
    if futures_uncertainty_bump > 0:
        parts.append(f"futures_reliability_penalty=+{futures_uncertainty_bump:.1f}")
    return "; ".join(parts) + "."


def score_option_from_features(
    fv: OptionFeatureVector,
    *,
    futures_reliability: FutureReliabilityReport | None = None,
    grounded_coverage: float = 0.0,
    clamp_uncertainty: bool = True,
) -> OptionEvaluation:
    """Convert auditable features into legacy OptionEvaluation scores (0..10).

    ``grounded_coverage`` must be **per-option** coverage (not batch average).
    Goal alignment is scored only in ``goal_alignment_score``, not in EV.
    """
    upside = _level_value(fv.upside_potential_level, benefit=True, status=_status_for(fv, "upside_potential_level"))
    goal = _level_value(fv.goal_alignment_level, benefit=True, status=_status_for(fv, "goal_alignment_level"))
    time_cost = _level_value(fv.time_cost_level, benefit=False, status=_status_for(fv, "time_cost_level"))
    money_cost = _level_value(fv.money_cost_level, benefit=False, status=_status_for(fv, "money_cost_level"))
    opp_cost = _level_value(fv.opportunity_cost_level, benefit=False, status=_status_for(fv, "opportunity_cost_level"))

    violation_penalty = min(3.0, len(fv.hard_constraint_violations) * 1.5)
    # EV: upside and costs only — goal lives in goal_alignment_score to avoid double counting.
    ev_raw = (
        4.0
        + 3.5 * upside
        - 2.0 * time_cost
        - 1.5 * money_cost
        - 1.5 * opp_cost
        - violation_penalty
    )
    expected_value_score = _clamp_score(ev_raw)

    rev_risk = _reversibility_as_risk(fv.reversibility_level)
    risk_levels = [
        fv.downside_severity_level,
        fv.stress_load_level,
        fv.workload_level,
        fv.constraint_conflict_level,
        rev_risk,
    ]
    risk_statuses = [_status_for(fv, k) for k in (
        "downside_severity_level", "stress_load_level", "workload_level",
        "constraint_conflict_level", "reversibility_level",
    )]
    risk_raw = 10.0 * _avg_risk_levels(risk_levels, risk_statuses)
    risk_score = _clamp_score(risk_raw + violation_penalty * 0.5)

    regret_levels = [
        fv.opportunity_cost_level,
        fv.switching_cost_level,
        rev_risk,
        fv.downside_severity_level,
    ]
    regret_statuses = [_status_for(fv, k) for k in (
        "opportunity_cost_level", "switching_cost_level", "reversibility_level", "downside_severity_level",
    )]
    regret_score = _clamp_score(10.0 * _avg_risk_levels(regret_levels, regret_statuses))

    unknown_count = sum(1 for k in CRITICAL_FEATURE_KEYS if _status_for(fv, k) == "unknown")
    candidate_count = sum(1 for k in CRITICAL_FEATURE_KEYS if _status_for(fv, k) == "candidate")
    uncertainty_raw = (
        2.0
        + fv.missing_critical_info_count * 1.0
        + unknown_count * 0.65
        + candidate_count * 0.30
        + (1.0 - _provenance_coverage(fv)) * 2.5
        + max(0.0, (COVERAGE_UNCERTAINTY_THRESHOLD - grounded_coverage)) * 3.5
    )

    futures_bump = 0.0
    if futures_reliability is not None:
        if futures_reliability.score_use in ("explanation_only", "needs_more_info", "discard"):
            reliability_gap = 1.0 - min(
                futures_reliability.structure_validity,
                futures_reliability.grounding_coverage,
                futures_reliability.decision_relevance,
            )
            futures_bump = reliability_gap * 2.5

    uncertainty_raw_val = uncertainty_raw + futures_bump
    uncertainty_score = (
        _clamp_score(uncertainty_raw_val) if clamp_uncertainty else uncertainty_raw_val
    )

    conflict_risk = _level_value(
        fv.constraint_conflict_level,
        benefit=False,
        status=_status_for(fv, "constraint_conflict_level"),
    )
    goal_align_raw = 3.0 + 6.0 * goal - 2.5 * conflict_risk - violation_penalty
    goal_alignment_score = _clamp_score(goal_align_raw)

    rationale = _build_rationale(fv, futures_uncertainty_bump=futures_bump, coverage=grounded_coverage)
    rationale = _build_rationale(fv, futures_uncertainty_bump=futures_bump, coverage=grounded_coverage)
    return OptionEvaluation(
        option_id=fv.option_id,
        expected_value_score=round(expected_value_score, 2),
        risk_score=round(risk_score, 2),
        regret_score=round(regret_score, 2),
        uncertainty_score=round(uncertainty_score, 2),
        goal_alignment_score=round(goal_alignment_score, 2),
        rationale=rationale,
    )


def _score_with_raw_uncertainty(
    fv: OptionFeatureVector,
    *,
    futures_reliability: FutureReliabilityReport | None = None,
    grounded_coverage: float = 0.0,
) -> tuple[OptionEvaluation, float]:
    """Internal: return evaluation plus pre-clamp uncertainty for batch normalization."""
    unknown_count = sum(1 for k in CRITICAL_FEATURE_KEYS if _status_for(fv, k) == "unknown")
    candidate_count = sum(1 for k in CRITICAL_FEATURE_KEYS if _status_for(fv, k) == "candidate")
    uncertainty_raw = (
        2.0
        + fv.missing_critical_info_count * 1.0
        + unknown_count * 0.65
        + candidate_count * 0.30
        + (1.0 - _provenance_coverage(fv)) * 2.5
        + max(0.0, (COVERAGE_UNCERTAINTY_THRESHOLD - grounded_coverage)) * 3.5
    )
    futures_bump = 0.0
    if futures_reliability is not None:
        if futures_reliability.score_use in ("explanation_only", "needs_more_info", "discard"):
            reliability_gap = 1.0 - min(
                futures_reliability.structure_validity,
                futures_reliability.grounding_coverage,
                futures_reliability.decision_relevance,
            )
            futures_bump = reliability_gap * 2.5
    raw_u = uncertainty_raw + futures_bump
    ev = score_option_from_features(
        fv,
        futures_reliability=futures_reliability,
        grounded_coverage=grounded_coverage,
        clamp_uncertainty=True,
    )
    return ev, raw_u


def score_options_from_features(
    feature_vectors: list[OptionFeatureVector],
    *,
    reliability_by_option: dict[str, FutureReliabilityReport] | None = None,
    grounded_coverage: float = 0.0,
    relative_uncertainty: bool = True,
) -> list[OptionEvaluation]:
    """Score each option; optionally normalize uncertainty within the batch."""
    from foresight_x.simulation.feature_merge import option_grounded_coverage

    rel = reliability_by_option or {}
    use_per_option = grounded_coverage <= 0.0
    pairs: list[tuple[OptionEvaluation, float]] = []
    for fv in feature_vectors:
        cov = option_grounded_coverage(fv) if use_per_option else grounded_coverage
        ev, raw_u = _score_with_raw_uncertainty(
            fv,
            futures_reliability=rel.get(fv.option_id),
            grounded_coverage=cov,
        )
        pairs.append((ev, raw_u))

    if not relative_uncertainty or len(pairs) <= 1:
        return [ev for ev, _ in pairs]

    raw_vals = [u for _, u in pairs]
    lo, hi = min(raw_vals), max(raw_vals)
    out: list[OptionEvaluation] = []
    for ev, raw_u in pairs:
        if hi > lo:
            norm_u = _clamp_score(10.0 * (raw_u - lo) / (hi - lo))
        else:
            norm_u = _clamp_score(raw_u)
        out.append(ev.model_copy(update={"uncertainty_score": round(norm_u, 2)}))
    return out
