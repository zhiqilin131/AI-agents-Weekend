from __future__ import annotations

from math import sqrt

from foresight_x.decision_algorithms.schemas import (
    DecisionCriterion,
    DecisionOption,
    MCDAResult,
    RankedOption,
)


DEFAULT_CRITERIA: list[DecisionCriterion] = [
    DecisionCriterion(key="value_alignment", kind="benefit", weight=0.14),
    DecisionCriterion(key="feasibility", kind="benefit", weight=0.12),
    DecisionCriterion(key="reversibility", kind="benefit", weight=0.10),
    DecisionCriterion(key="downside_protection", kind="benefit", weight=0.12),
    DecisionCriterion(key="upside_potential", kind="benefit", weight=0.10),
    DecisionCriterion(key="regret_risk", kind="cost", weight=0.10),
    DecisionCriterion(key="stress_load", kind="cost", weight=0.09),
    DecisionCriterion(key="schedule_fit", kind="benefit", weight=0.10),
    DecisionCriterion(key="uncertainty_exposure", kind="cost", weight=0.08),
    DecisionCriterion(key="first_step_cost", kind="cost", weight=0.05),
]


def _normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, v) for v in weights.values()) or 1.0
    return {k: max(0.0, v) / total for k, v in weights.items()}


def _heuristic_score(option: DecisionOption, criterion_key: str) -> float:
    """Deterministic fallback score in [0, 1] from option text only."""
    base = (sum(ord(ch) for ch in f"{option.id}|{criterion_key}") % 1000) / 1000.0
    text_bonus = min(0.2, len(option.description.strip()) / 800.0)
    asm_penalty = min(0.2, len(option.assumptions) * 0.03)
    s = max(0.0, min(1.0, base + text_bonus - asm_penalty))
    return s


def local_weighted_sum(
    options: list[DecisionOption],
    criteria: list[DecisionCriterion],
) -> tuple[list[tuple[str, float]], dict[str, dict[str, float]]]:
    by_opt: dict[str, float] = {}
    score_table: dict[str, dict[str, float]] = {}
    for opt in options:
        total = 0.0
        row: dict[str, float] = {}
        for c in criteria:
            raw = _heuristic_score(opt, c.key)
            norm = raw if c.kind == "benefit" else 1.0 - raw
            row[c.key] = norm
            total += c.weight * norm
        by_opt[opt.id] = total
        score_table[opt.id] = row
    ranked = sorted(by_opt.items(), key=lambda x: x[1], reverse=True)
    return ranked, score_table


def local_topsis(
    options: list[DecisionOption],
    criteria: list[DecisionCriterion],
) -> tuple[list[tuple[str, float]], dict[str, dict[str, float]]]:
    matrix: list[list[float]] = []
    for opt in options:
        matrix.append([_heuristic_score(opt, c.key) for c in criteria])

    # Vector normalization by criterion column
    col_denoms: list[float] = []
    for j in range(len(criteria)):
        denom = sqrt(sum(row[j] ** 2 for row in matrix)) or 1.0
        col_denoms.append(denom)
    norm = [[row[j] / col_denoms[j] for j in range(len(criteria))] for row in matrix]
    weighted = [[norm[i][j] * criteria[j].weight for j in range(len(criteria))] for i in range(len(options))]

    ideal_best: list[float] = []
    ideal_worst: list[float] = []
    for j, c in enumerate(criteria):
        col = [weighted[i][j] for i in range(len(options))]
        if c.kind == "benefit":
            ideal_best.append(max(col))
            ideal_worst.append(min(col))
        else:
            ideal_best.append(min(col))
            ideal_worst.append(max(col))

    closeness: dict[str, float] = {}
    table: dict[str, dict[str, float]] = {}
    for i, opt in enumerate(options):
        d_pos = sqrt(sum((weighted[i][j] - ideal_best[j]) ** 2 for j in range(len(criteria))))
        d_neg = sqrt(sum((weighted[i][j] - ideal_worst[j]) ** 2 for j in range(len(criteria))))
        c = d_neg / (d_pos + d_neg + 1e-9)
        closeness[opt.id] = c
        table[opt.id] = {criteria[j].key: weighted[i][j] for j in range(len(criteria))}
    ranked = sorted(closeness.items(), key=lambda x: x[1], reverse=True)
    return ranked, table


def evaluate_options_mcda(
    options: list[DecisionOption],
    criteria: list[DecisionCriterion] | None = None,
    weights: dict[str, float] | None = None,
    method: str = "topsis",
) -> MCDAResult:
    criteria_list = criteria or [x.model_copy(deep=True) for x in DEFAULT_CRITERIA]
    if weights:
        for c in criteria_list:
            if c.key in weights:
                c.weight = max(0.0, float(weights[c.key]))
    norm_weights = _normalize_weights({c.key: c.weight for c in criteria_list})
    criteria_list = [c.model_copy(update={"weight": norm_weights[c.key]}) for c in criteria_list]

    # Optional library path (non-blocking)
    lib_used = None
    if method.lower() == "topsis":
        try:
            import pymcdm  # type: ignore # noqa: F401
            lib_used = "pymcdm_available"
        except Exception:
            lib_used = None

    if method.lower() == "weighted_sum":
        ranked_pairs, score_table = local_weighted_sum(options, criteria_list)
        used_method = "weighted_sum_fallback"
    else:
        ranked_pairs, score_table = local_topsis(options, criteria_list)
        used_method = "topsis_fallback"

    ranked: list[RankedOption] = []
    for idx, (option_id, score) in enumerate(ranked_pairs, start=1):
        row = score_table.get(option_id, {})
        best_keys = sorted(row.items(), key=lambda x: x[1], reverse=True)[:2]
        weak_keys = sorted(row.items(), key=lambda x: x[1])[:2]
        ranked.append(
            RankedOption(
                option_id=option_id,
                rank=idx,
                score=round(float(score), 4),
                strengths=[f"strong {k}" for k, _ in best_keys],
                weaknesses=[f"weaker {k}" for k, _ in weak_keys],
                dominant_criteria=[k for k, _ in best_keys],
            )
        )

    notes = [
        "Weights are normalized; relative ranking may change if schedule_fit or downside_protection is emphasized.",
    ]
    if lib_used:
        notes.append("pymcdm detected; fallback kept for deterministic compatibility.")
    return MCDAResult(
        method=used_method,
        ranked_options=ranked,
        criteria_weights=norm_weights,
        criteria_scores=score_table,
        sensitivity_notes=notes,
    )

