"""Score options from auditable feature vectors (deterministic MCDA)."""

from __future__ import annotations

from typing import Any, Protocol

from foresight_x.schemas import (
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    SimulatedFuture,
    UserState,
)
from foresight_x.simulation.feature_audit import build_feature_audit, evaluate_with_audit
from foresight_x.simulation.feature_confirmation import apply_confirmed_candidates, apply_scoring_clarification_to_options
from foresight_x.simulation.feature_extractor import extract_features_for_options
from foresight_x.simulation.feature_merge import ensure_option_tags, grounded_coverage
from foresight_x.simulation.feature_schemas import FeatureAuditBundle
from foresight_x.simulation.feature_scorer import score_options_from_features
from foresight_x.simulation.future_reliability import assess_futures_reliability


class StructuredPredictLLM(Protocol):
    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        ...


def evaluate_options_from_features(
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
    futures: list[SimulatedFuture] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
) -> list[OptionEvaluation]:
    """Preferred path: grounded features -> deterministic OptionEvaluation scores."""
    evaluations, _, _ = evaluate_with_audit(
        options,
        user_state,
        evidence,
        memory,
        futures,
        scoring_clarification,
        confirmed_candidates,
    )
    return evaluations


def build_evaluation_audit(
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
    futures: list[SimulatedFuture] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
) -> FeatureAuditBundle:
    return build_feature_audit(
        options,
        user_state,
        evidence,
        memory,
        futures,
        scoring_clarification,
        confirmed_candidates,
    )


def _legacy_heuristic_from_future(future: SimulatedFuture, user_state: UserState) -> OptionEvaluation:
    if not future.scenarios:
        m = {"ev": 5.0, "risk": 5.0, "regret": 5.0, "unc": 5.0}
    else:
        by_label = {s.label: s for s in future.scenarios}
        best_p = by_label.get("best", future.scenarios[0]).probability
        base_p = by_label.get("base", future.scenarios[0]).probability
        worst_p = by_label.get("worst", future.scenarios[-1]).probability
        m = {
            "ev": best_p * 10.0 + base_p * 5.0 + worst_p * 0.0,
            "risk": min(10.0, worst_p * 10.0 + abs(best_p - worst_p) * 5.0),
            "regret": min(10.0, worst_p * 10.0),
            "unc": min(10.0, (1.0 - max(best_p, base_p, worst_p)) * 10.0),
        }
    ga = min(10.0, 4.0 + 6.0 * (1.0 - user_state.stress_level / 10.0))
    rationale = (
        f"Legacy fallback from {future.time_horizon} scenario weights (not feature-grounded): "
        f"EV≈{m['ev']:.1f}, tail emphasis {m['regret']:.1f}. "
        "Prefer evaluate_options_from_features when options/evidence are available."
    )
    return OptionEvaluation(
        option_id=future.option_id,
        expected_value_score=m["ev"],
        risk_score=m["risk"],
        regret_score=m["regret"],
        uncertainty_score=m["unc"],
        goal_alignment_score=ga,
        rationale=rationale,
    )


def evaluate_options(
    futures: list[SimulatedFuture],
    user_state: UserState,
    llm: StructuredPredictLLM | None = None,
    *,
    options: list[Option] | None = None,
    evidence: EvidenceBundle | None = None,
    memory: MemoryBundle | None = None,
    scoring_clarification: dict[str, str] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
) -> list[OptionEvaluation]:
    """Evaluate options deterministically. LLM is ignored for numeric scores."""
    del llm
    if not futures and not options:
        return []

    if options and evidence is not None:
        return evaluate_options_from_features(
            options,
            user_state,
            evidence,
            memory,
            futures=futures or None,
            scoring_clarification=scoring_clarification,
            confirmed_candidates=confirmed_candidates,
        )

    if not futures:
        return []

    return [_legacy_heuristic_from_future(f, user_state) for f in futures]
