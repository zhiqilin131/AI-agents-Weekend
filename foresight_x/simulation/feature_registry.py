"""Single source of truth for MCDA critical feature metadata."""

from __future__ import annotations

from foresight_x.simulation.feature_schemas import CRITICAL_FEATURE_KEYS, OptionFeatureVector

FeaturePolarity = str  # "cost" | "benefit"

FEATURE_POLARITY: dict[str, FeaturePolarity] = {
    "time_cost_level": "cost",
    "money_cost_level": "cost",
    "stress_load_level": "cost",
    "workload_level": "cost",
    "downside_severity_level": "cost",
    "upside_potential_level": "benefit",
    "goal_alignment_level": "benefit",
    "reversibility_level": "benefit",
}

FEATURE_LABELS: dict[str, str] = {
    "time_cost_level": "time cost",
    "money_cost_level": "money cost",
    "stress_load_level": "stress load",
    "workload_level": "workload",
    "reversibility_level": "reversibility",
    "downside_severity_level": "downside severity",
    "upside_potential_level": "upside potential",
    "goal_alignment_level": "goal alignment",
}

QUESTION_TEMPLATES: dict[str, str] = {
    "time_cost_level": "How much time would {option_name} realistically require?",
    "money_cost_level": "Would {option_name} materially change your money situation?",
    "stress_load_level": "How stressful would {option_name} be for you?",
    "workload_level": "How heavy is the workload for {option_name}?",
    "reversibility_level": "How easy would it be to reverse {option_name} if it goes wrong?",
    "downside_severity_level": "If {option_name} fails, how bad could the downside be?",
    "upside_potential_level": "How much upside does {option_name} offer toward your goals?",
    "goal_alignment_level": "How well does {option_name} fit your stated goals?",
}

# Approximate composite sensitivity when a feature moves low→high (VoI prior).
FEATURE_VOI_PRIOR: dict[str, float] = {
    "upside_potential_level": 0.85,
    "goal_alignment_level": 0.75,
    "money_cost_level": 0.55,
    "time_cost_level": 0.50,
    "stress_load_level": 0.45,
    "workload_level": 0.40,
    "downside_severity_level": 0.50,
    "reversibility_level": 0.35,
}

COST_FEATURES = frozenset(k for k, p in FEATURE_POLARITY.items() if p == "cost")
BENEFIT_FEATURES = frozenset(k for k, p in FEATURE_POLARITY.items() if p == "benefit")

_LEVEL_NUM = {"low": 0.0, "medium": 1.0, "high": 2.0}


def level_keys() -> tuple[str, ...]:
    return CRITICAL_FEATURE_KEYS


def feature_label(key: str) -> str:
    return FEATURE_LABELS.get(key, key.replace("_level", "").replace("_", " "))


def is_cost_feature(key: str) -> bool:
    return key in COST_FEATURES


def feature_spread(feature_vectors: list[OptionFeatureVector], feature_key: str) -> float | None:
    """Normalized spread for a single feature across options (0..1), or None if <2 known."""
    vals: list[float] = []
    for fv in feature_vectors:
        st = (fv.field_status or {}).get(feature_key, "unknown")
        val = getattr(fv, feature_key, "unknown")
        if st == "known" and val in _LEVEL_NUM:
            vals.append(_LEVEL_NUM[val])  # type: ignore[index]
    if len(vals) < 2:
        return None
    return (max(vals) - min(vals)) / 2.0


def comparative_priority_keys(
    feature_vectors: list[OptionFeatureVector],
    *,
    missing_only: bool = True,
) -> list[str]:
    """Rank features for comparative elicitation: lowest spread / most unknown first."""
    scored: list[tuple[float, str]] = []
    for key in CRITICAL_FEATURE_KEYS:
        if missing_only:
            unknown_count = sum(
                1
                for fv in feature_vectors
                if (fv.field_status or {}).get(key, "unknown") != "known"
                or getattr(fv, key, "unknown") == "unknown"
            )
            if unknown_count < 2:
                continue
        spread = feature_spread(feature_vectors, key)
        # Lower spread → higher priority; unknown spread → treat as 0 (highest priority)
        priority = spread if spread is not None else 0.0
        voi = FEATURE_VOI_PRIOR.get(key, 0.25)
        scored.append((priority - voi * 0.05, key))
    scored.sort(key=lambda x: x[0])
    return [k for _, k in scored]


def registry_export() -> dict:
    """JSON-serializable registry for API / frontend."""
    return {
        "critical_feature_keys": list(CRITICAL_FEATURE_KEYS),
        "labels": dict(FEATURE_LABELS),
        "polarity": dict(FEATURE_POLARITY),
        "question_templates": dict(QUESTION_TEMPLATES),
        "voi_prior": dict(FEATURE_VOI_PRIOR),
    }
