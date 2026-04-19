"""Pick an option and produce a Recommendation."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Protocol

from foresight_x.decision.deadline_normalize import normalize_recommendation_deadlines
from foresight_x.structured_predict import structured_predict
from foresight_x.prompts.recommender import recommender_prompt
from foresight_x.schemas import (
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    Recommendation,
    NextAction,
    UserState,
)


class StructuredPredictLLM(Protocol):
    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        ...


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


DEFAULT_EVALUATION_WEIGHTS: dict[str, float] = {
    "expected_value_score": 0.25,
    "risk_score": -0.15,
    "regret_score": -0.15,
    "uncertainty_score": -0.15,
    "goal_alignment_score": 0.25,
}


def composite_score(evaluation: OptionEvaluation, weights: dict[str, float]) -> float:
    total = 0.0
    for key, w in weights.items():
        total += w * float(getattr(evaluation, key))
    return total


def _fallback_recommendation(chosen: Option, composite_by_option_id: dict[str, float]) -> Recommendation:
    return Recommendation(
        chosen_option_id=chosen.option_id,
        reasoning=(
            f"Selected {chosen.name} with highest weighted composite score among options "
            f"(scores: {composite_by_option_id}). "
            "Weights favor expected value and goal alignment; penalize risk, regret, and uncertainty."
        ),
        next_actions=[
            NextAction(
                action=f"Write a one-page decision memo for: {chosen.name}",
                deadline=None,
                artifacts=["decision_memo.md"],
            ),
            NextAction(
                action="List top three assumptions to validate this week",
                deadline=None,
                artifacts=["assumptions_checklist"],
            ),
        ],
        reassessment_triggers=[
            "New material facts appear",
            "Deadline or offer terms change",
            "Stress or workload spikes",
        ],
    )


def recommend(
    evaluations: list[OptionEvaluation],
    options: list[Option],
    evidence: EvidenceBundle,
    memory: MemoryBundle,
    *,
    user_state: UserState,
    weights: dict[str, float] | None = None,
    llm: StructuredPredictLLM | None = None,
    anchor_now_iso: str | None = None,
) -> Recommendation:
    """Argmax composite score, then optional LLM narrative for reasoning and actions."""
    if not options:
        raise ValueError("recommend requires at least one option")
    w = weights or DEFAULT_EVALUATION_WEIGHTS
    by_eval = {e.option_id: e for e in evaluations}
    composite_by_option_id: dict[str, float] = {}
    for opt in options:
        ev = by_eval.get(opt.option_id)
        if ev is not None:
            composite_by_option_id[opt.option_id] = composite_score(ev, w)

    if composite_by_option_id:
        best_id = max(composite_by_option_id, key=lambda k: composite_by_option_id[k])
        chosen = next(o for o in options if o.option_id == best_id)
    else:
        chosen = options[0]

    anchor = (anchor_now_iso.strip() if anchor_now_iso else None) or _utc_now_iso()

    if llm is None:
        return normalize_recommendation_deadlines(
            _fallback_recommendation(chosen, composite_by_option_id),
            anchor,
        )

    prompt = recommender_prompt(
        chosen,
        evaluations,
        options,
        evidence,
        memory,
        composite_by_option_id,
        user_state,
        anchor_now_iso=anchor,
    )
    try:
        raw = structured_predict(llm, Recommendation, prompt)
        rec = raw if isinstance(raw, Recommendation) else Recommendation.model_validate(raw)
        valid_ids = {o.option_id for o in options}
        if rec.chosen_option_id not in valid_ids:
            rec = rec.model_copy(update={"chosen_option_id": chosen.option_id})
        return normalize_recommendation_deadlines(rec, anchor)
    except Exception:
        return normalize_recommendation_deadlines(
            _fallback_recommendation(chosen, composite_by_option_id),
            anchor,
        )
