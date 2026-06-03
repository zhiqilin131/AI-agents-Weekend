"""Composite weight audit and ranking fragility analysis."""

from __future__ import annotations

from foresight_x.decision.recommender import (
    DEFAULT_EVALUATION_WEIGHTS,
    composite_score,
    evaluation_weights_for_risk_posture,
)
from foresight_x.schemas import OptionEvaluation

_SCORE_KEYS = tuple(DEFAULT_EVALUATION_WEIGHTS.keys())
_FRAGility_EPSILON = 0.15


def build_weight_audit(
    evaluations: list[OptionEvaluation],
    *,
    composite_by_option_id: dict[str, float],
    winner_id: str,
    risk_posture: str | None = None,
    applied_weights: dict[str, float] | None = None,
) -> dict:
    """Audit applied weights and flag criteria that could flip the ranking."""
    base = evaluation_weights_for_risk_posture(risk_posture)
    w = applied_weights or base
    if not evaluations or not composite_by_option_id:
        return {
            "base_weights": dict(DEFAULT_EVALUATION_WEIGHTS),
            "applied_weights": dict(w),
            "risk_posture": risk_posture or "unknown",
            "fragile_criteria": [],
            "ranking_stable_under_weight_perturbation": True,
            "winner_margin": 0.0,
            "winner_id": winner_id,
        }

    sorted_scores = sorted(composite_by_option_id.values(), reverse=True)
    margin = sorted_scores[0] - sorted_scores[1] if len(sorted_scores) > 1 else sorted_scores[0]

    fragile: list[str] = []
    for key in _SCORE_KEYS:
        vals = [float(getattr(e, key)) for e in evaluations]
        swing = max(vals) - min(vals) if vals else 0.0
        if swing <= 0:
            continue
        weight_mag = abs(w.get(key, 0.0))
        leverage = weight_mag * swing
        if margin < _FRAGility_EPSILON * leverage:
            fragile.append(key)

    stable = len(fragile) == 0 and margin > 0.05

    return {
        "base_weights": dict(DEFAULT_EVALUATION_WEIGHTS),
        "applied_weights": dict(w),
        "risk_posture": risk_posture or "unknown",
        "weight_rationale": (
            f"Adjusted from risk_posture={risk_posture or 'unknown'}."
            if w != DEFAULT_EVALUATION_WEIGHTS
            else "Default MAVT weights."
        ),
        "fragile_criteria": fragile,
        "ranking_stable_under_weight_perturbation": stable,
        "winner_margin": round(margin, 4),
        "winner_id": winner_id,
        "composite_by_option_id": {k: round(v, 4) for k, v in composite_by_option_id.items()},
    }


def composite_map(
    evaluations: list[OptionEvaluation],
    risk_posture: str | None = None,
) -> tuple[dict[str, float], dict[str, float]]:
    w = evaluation_weights_for_risk_posture(risk_posture)
    by_id = {e.option_id: composite_score(e, w) for e in evaluations}
    return by_id, w
