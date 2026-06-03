"""Lightweight gate: simulated futures are explanatory, not scoring inputs."""

from __future__ import annotations

import re

from foresight_x.schemas import EvidenceBundle, Option, SimulatedFuture, UserState
from foresight_x.simulation.feature_schemas import FutureReliabilityReport, FutureScoreUse

DECISION_RELEVANCE_TERMS = (
    "time",
    "money",
    "cost",
    "stress",
    "workload",
    "revers",
    "deadline",
    "goal",
    "constraint",
    "risk",
    "recover",
    "switch",
    "opportunity",
    "downside",
    "upside",
)

BLOCKED_SCORING_USES = [
    "expected_value_score",
    "risk_score",
    "regret_score",
    "goal_alignment_score",
    "probability_weighted_ranking",
]

ALLOWED_WEAK_USES = [
    "explanation",
    "stress_test",
    "assumption_discovery",
    "early_warning_signals",
    "reassessment_triggers",
    "missing_field_prompts",
]


def _structure_validity(future: SimulatedFuture) -> tuple[float, list[str]]:
    missing: list[str] = []
    if not future.scenarios:
        return 0.0, ["scenarios"]
    labels = {s.label for s in future.scenarios}
    if labels != {"best", "base", "worst"}:
        missing.append("best_base_worst_labels")
    empty_traj = sum(1 for s in future.scenarios if not (s.trajectory or "").strip())
    empty_drivers = sum(1 for s in future.scenarios if not s.key_drivers)
    if empty_traj:
        missing.append("trajectories")
    if empty_drivers:
        missing.append("key_drivers")
    score = 1.0
    if "best_base_worst_labels" in missing:
        score -= 0.5
    score -= 0.15 * empty_traj
    score -= 0.15 * empty_drivers
    return max(0.0, min(1.0, score)), missing


def _probability_validity(future: SimulatedFuture) -> float:
    if not future.scenarios:
        return 0.0
    total = sum(s.probability for s in future.scenarios)
    sum_ok = 1.0 if abs(total - 1.0) <= 0.05 else max(0.0, 1.0 - abs(total - 1.0) * 3)
    probs = [s.probability for s in future.scenarios]
    extreme = sum(1 for p in probs if p >= 0.92 or p <= 0.03)
    spread_ok = 1.0 if extreme <= 1 else max(0.2, 1.0 - 0.25 * (extreme - 1))
    return max(0.0, min(1.0, 0.6 * sum_ok + 0.4 * spread_ok))


def _token_set(text: str) -> set[str]:
    return {w.lower() for w in re.findall(r"[a-zA-Z]{4,}", text)}


def _grounding_coverage(
    future: SimulatedFuture,
    option: Option,
    user_state: UserState,
    evidence: EvidenceBundle,
) -> float:
    anchors: set[str] = set()
    for g in user_state.goals:
        anchors |= _token_set(g)
    for c in user_state.profile_constraints:
        anchors |= _token_set(c)
    for a in option.key_assumptions:
        anchors |= _token_set(a)
    for f in evidence.facts + evidence.base_rates + evidence.recent_events:
        anchors |= _token_set(f.text)
    if not anchors:
        return 0.35
    future_text = " ".join(
        s.trajectory + " " + " ".join(s.key_drivers) for s in future.scenarios
    )
    fut_tokens = _token_set(future_text)
    if not fut_tokens:
        return 0.0
    overlap = len(anchors & fut_tokens) / max(1, min(len(anchors), 12))
    return max(0.0, min(1.0, overlap * 1.4))


def _scenario_consistency(future: SimulatedFuture) -> float:
    if len(future.scenarios) < 3:
        return 0.0
    driver_sets: list[set[str]] = []
    for s in future.scenarios:
        tokens: set[str] = set()
        for d in s.key_drivers:
            tokens |= _token_set(d)
        driver_sets.append(tokens)
    if not all(driver_sets):
        return 0.3
    union = set().union(*driver_sets)
    if not union:
        return 0.3
    overlaps = []
    for i in range(len(driver_sets)):
        for j in range(i + 1, len(driver_sets)):
            inter = driver_sets[i] & driver_sets[j]
            overlaps.append(len(inter) / max(1, len(union)))
    return max(0.0, min(1.0, sum(overlaps) / max(1, len(overlaps))))


def _decision_relevance(future: SimulatedFuture) -> float:
    blob = " ".join(
        s.trajectory.lower() + " " + " ".join(d.lower() for d in s.key_drivers)
        for s in future.scenarios
    )
    hits = sum(1 for t in DECISION_RELEVANCE_TERMS if t in blob)
    generic_penalty = 0.15 if "manageable disruption" in blob or "partial progress" in blob else 0.0
    raw = min(1.0, hits / 6.0) - generic_penalty
    return max(0.0, raw)


def _probability_justifiability(evidence: EvidenceBundle, future: SimulatedFuture) -> float:
    has_base_rates = bool(evidence.base_rates)
    has_facts = bool(evidence.facts)
    if has_base_rates:
        return 0.75
    if has_facts:
        return 0.45
    probs = [s.probability for s in future.scenarios]
    if probs and max(probs) - min(probs) < 0.08:
        return 0.25
    return 0.15


def _pick_score_use(
    structure: float,
    grounding: float,
    relevance: float,
    justifiability: float,
) -> FutureScoreUse:
    composite = 0.3 * structure + 0.3 * grounding + 0.25 * relevance + 0.15 * justifiability
    if structure < 0.4:
        return "discard"
    if composite >= 0.65 and grounding >= 0.45 and relevance >= 0.45:
        return "score_eligible"
    if composite >= 0.4:
        return "explanation_only"
    return "needs_more_info"


def assess_future_reliability(
    future: SimulatedFuture,
    option: Option,
    user_state: UserState,
    evidence: EvidenceBundle,
) -> FutureReliabilityReport:
    """Check whether a simulated future may influence scoring (usually it may not)."""
    structure, missing = _structure_validity(future)
    prob_valid = _probability_validity(future)
    grounding = _grounding_coverage(future, option, user_state, evidence)
    consistency = _scenario_consistency(future)
    relevance = _decision_relevance(future)
    justifiability = _probability_justifiability(evidence, future)

    score_use = _pick_score_use(structure, grounding, relevance, justifiability)

    allowed = list(ALLOWED_WEAK_USES)
    blocked = list(BLOCKED_SCORING_USES)
    if score_use == "score_eligible":
        # Even when eligible, futures must not feed numeric MCDA in v1.
        blocked = list(BLOCKED_SCORING_USES)
        allowed.append("confidence_annotation")
    elif score_use == "discard":
        allowed = ["manual_review_flag"]
        blocked = blocked + ["explanation", "stress_test"]

    missing_fields = list(missing)
    if grounding < 0.35:
        missing_fields.append("grounding_anchors")
    if relevance < 0.35:
        missing_fields.append("decision_relevant_drivers")

    return FutureReliabilityReport(
        option_id=future.option_id,
        score_use=score_use,
        structure_validity=round(structure, 3),
        probability_validity=round(prob_valid, 3),
        grounding_coverage=round(grounding, 3),
        scenario_consistency=round(consistency, 3),
        decision_relevance=round(relevance, 3),
        probability_justifiability=round(justifiability, 3),
        missing_scoring_fields=missing_fields,
        allowed_uses=allowed,
        blocked_uses=blocked,
    )


def assess_futures_reliability(
    futures: list[SimulatedFuture],
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
) -> dict[str, FutureReliabilityReport]:
    by_option = {o.option_id: o for o in options}
    out: dict[str, FutureReliabilityReport] = {}
    for fut in futures:
        opt = by_option.get(fut.option_id)
        if opt is None:
            continue
        out[fut.option_id] = assess_future_reliability(fut, opt, user_state, evidence)
    return out
