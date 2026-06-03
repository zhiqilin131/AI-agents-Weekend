"""Value-of-information ranking for scoring clarify questions."""

from __future__ import annotations

from foresight_x.decision.recommender import DEFAULT_EVALUATION_WEIGHTS, composite_score, evaluation_weights_for_risk_posture
from foresight_x.schemas import Option, OptionEvaluation
from foresight_x.simulation.feature_schemas import CRITICAL_FEATURE_KEYS, FeatureLevel, OptionFeatureVector, ScoringClarifyQuestion
from foresight_x.simulation.feature_scorer import score_option_from_features
from foresight_x.simulation.feature_merge import option_grounded_coverage

_LEVELS: tuple[FeatureLevel, ...] = ("low", "medium", "high")

# Approximate composite sensitivity when a feature moves low→high (for fast VoI).
_FEATURE_VOI_PRIOR: dict[str, float] = {
    "upside_potential_level": 0.85,
    "goal_alignment_level": 0.75,
    "money_cost_level": 0.55,
    "time_cost_level": 0.50,
    "stress_load_level": 0.45,
    "workload_level": 0.40,
    "downside_severity_level": 0.50,
    "reversibility_level": 0.35,
}


def _patch_fv(fv: OptionFeatureVector, feature_key: str, level: FeatureLevel) -> OptionFeatureVector:
    statuses = dict(fv.field_status or {})
    statuses[feature_key] = "known"
    payload = fv.model_dump()
    payload[feature_key] = level
    payload["field_status"] = statuses
    payload["missing_critical_info_count"] = sum(
        1 for k in CRITICAL_FEATURE_KEYS if statuses.get(k, "unknown") == "unknown"
    )
    return OptionFeatureVector.model_validate(payload)


def _composite_swing_for_field(
    fv: OptionFeatureVector,
    feature_key: str,
    weights: dict[str, float],
) -> float:
    """Max − min composite when feature is set to low/medium/high (known)."""
    scores: list[float] = []
    cov = option_grounded_coverage(fv)
    for lv in _LEVELS:
        patched = _patch_fv(fv, feature_key, lv)
        ev = score_option_from_features(patched, grounded_coverage=cov)
        scores.append(composite_score(ev, weights))
    return max(scores) - min(scores) if scores else 0.0


def _winner_flip_bonus(
    feature_key: str,
    option_id: str,
    feature_vectors: list[OptionFeatureVector],
    evaluations: list[OptionEvaluation],
    weights: dict[str, float],
) -> float:
    """Bonus VoI if clarifying this field could change the winner."""
    by_id = {e.option_id: e for e in evaluations}
    if not by_id:
        return 0.0
    base_composites = {oid: composite_score(e, weights) for oid, e in by_id.items()}
    winner = max(base_composites, key=base_composites.get)  # type: ignore[arg-type]
    margin = base_composites[winner] - max(
        (v for oid, v in base_composites.items() if oid != winner),
        default=base_composites[winner],
    )
    if margin > 0.5:
        return 0.0

    fv_map = {fv.option_id: fv for fv in feature_vectors}
    target = fv_map.get(option_id)
    if target is None:
        return 0.0

    for lv in _LEVELS:
        patched = _patch_fv(target, feature_key, lv)
        ev = score_option_from_features(patched, grounded_coverage=option_grounded_coverage(patched))
        trial = dict(base_composites)
        trial[option_id] = composite_score(ev, weights)
        new_winner = max(trial, key=trial.get)  # type: ignore[arg-type]
        if new_winner != winner:
            return 0.5
    return 0.0


def rank_questions_by_voi(
    questions: list[ScoringClarifyQuestion],
    feature_vectors: list[OptionFeatureVector],
    evaluations: list[OptionEvaluation],
    *,
    risk_posture: str | None = None,
) -> list[ScoringClarifyQuestion]:
    """Sort clarify questions by approximate value-of-information (descending)."""
    if not questions:
        return []
    weights = evaluation_weights_for_risk_posture(risk_posture)
    fv_map = {fv.option_id: fv for fv in feature_vectors}

    scored: list[tuple[float, ScoringClarifyQuestion]] = []
    for q in questions:
        oid = q.option_id or ""
        fkey = q.feature_key
        fv = fv_map.get(oid)
        if fv is None:
            voi = _FEATURE_VOI_PRIOR.get(fkey, 0.25)
        else:
            swing = _composite_swing_for_field(fv, fkey, weights)
            flip = _winner_flip_bonus(fkey, oid, feature_vectors, evaluations, weights)
            voi = swing + flip + _FEATURE_VOI_PRIOR.get(fkey, 0.1) * 0.1
        scored.append((voi, q.model_copy(update={"voi_score": round(voi, 3)})))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [q for _, q in scored]
