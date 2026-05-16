"""Pick an option and produce a Recommendation."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Protocol

from foresight_x.config import load_settings
from foresight_x.decision.deadline_normalize import normalize_recommendation_deadlines
from foresight_x.memory.profile_store import empty_profile, load_profile
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

MAX_EXECUTION_READY_ACTIONS = 4
_COMPOSITE_TIE_EPSILON = 1e-3


def composite_score(evaluation: OptionEvaluation, weights: dict[str, float]) -> float:
    total = 0.0
    for key, w in weights.items():
        total += w * float(getattr(evaluation, key))
    return total


def _keyword_overlap_score(option: Option, user_state: UserState) -> float:
    """Lexical overlap between the user's question and an option (for tie-breaking)."""
    stop = {
        "with",
        "that",
        "this",
        "from",
        "your",
        "have",
        "what",
        "when",
        "where",
        "should",
        "would",
        "could",
        "about",
        "into",
        "the",
        "and",
        "for",
    }
    ctx = {
        w
        for w in re.findall(r"[a-zA-Z]{3,}", (user_state.raw_input or "").lower())
        if w not in stop
    }
    if not ctx:
        return 0.0
    opt_words = {
        w
        for w in re.findall(
            r"[a-zA-Z]{3,}",
            f"{option.name} {option.description} {' '.join(option.key_assumptions)}".lower(),
        )
        if w not in stop
    }
    return len(ctx & opt_words) / len(ctx)


def _deferral_penalty(option: Option) -> int:
    """Prefer substantive paths over generic delay when composite scores tie."""
    blob = f"{option.option_id} {option.name}".lower()
    if "ask_extension" in blob or "more time" in blob:
        return 2
    if "information_sprint" in blob and "48-hour" in blob:
        return 1
    return 0


def _pick_chosen_option(
    composite_by_option_id: dict[str, float],
    options: list[Option],
    user_state: UserState,
) -> Option:
    if not composite_by_option_id:
        return options[0]
    best_score = max(composite_by_option_id.values())
    tied_ids = [
        oid
        for oid, score in composite_by_option_id.items()
        if abs(score - best_score) <= _COMPOSITE_TIE_EPSILON
    ]
    if len(tied_ids) == 1:
        return next(o for o in options if o.option_id == tied_ids[0])
    by_id = {o.option_id: o for o in options}
    candidates = [by_id[oid] for oid in tied_ids if oid in by_id]
    if not candidates:
        return options[0]
    return max(
        candidates,
        key=lambda o: (
            _keyword_overlap_score(o, user_state),
            -_deferral_penalty(o),
            -len(o.name),
        ),
    )


def _fallback_recommendation(
    chosen: Option,
    composite_by_option_id: dict[str, float],
    *,
    memory: MemoryBundle,
) -> Recommendation:
    influence_line = ""
    if memory.graph_influence and memory.graph_influence.top_nodes:
        tops = ", ".join(
            f"{n.label} ({n.score:.2f})" for n in memory.graph_influence.top_nodes[:3]
        )
        influence_line = f" Graph influence suggests these surfaced strongly: {tops}."
    return Recommendation(
        chosen_option_id=chosen.option_id,
        reasoning=(
            f"Selected {chosen.name} with highest weighted composite score among options "
            f"(scores: {composite_by_option_id}). "
            "Weights favor expected value and goal alignment; penalize risk, regret, and uncertainty."
            + influence_line
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


def _execution_ready_actions(actions: list[NextAction]) -> list[NextAction]:
    """Keep report-derived actions short, deduped, and realistic for the execution surface."""
    cleaned: list[NextAction] = []
    seen: set[str] = set()
    vague_exact = {
        "research",
        "research more",
        "think about it",
        "network",
        "make a plan",
        "consider options",
        "look into it",
    }
    for action in actions:
        text = " ".join(action.action.split())
        if not text:
            continue
        key = text.lower().rstrip(".")
        if key in seen:
            continue
        seen.add(key)
        if key in vague_exact and cleaned:
            continue
        cleaned.append(action.model_copy(update={"action": text}))
        if len(cleaned) >= MAX_EXECUTION_READY_ACTIONS:
            break
    return cleaned


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

    chosen = _pick_chosen_option(composite_by_option_id, options, user_state)

    anchor = (anchor_now_iso.strip() if anchor_now_iso else None) or _utc_now_iso()
    s = load_settings()
    profile = load_profile(s.foresight_user_id) or empty_profile(s.foresight_user_id)
    user_profile_json = profile.model_dump_json()

    if llm is None:
        return normalize_recommendation_deadlines(
            _fallback_recommendation(chosen, composite_by_option_id, memory=memory),
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
        user_profile_json,
        anchor_now_iso=anchor,
    )
    try:
        raw = structured_predict(llm, Recommendation, prompt)
        rec = raw if isinstance(raw, Recommendation) else Recommendation.model_validate(raw)
        # Always use the composite-score winner so UI ordering (same weights in mapTrace) matches the highlight.
        # The LLM only supplies reasoning and next_actions; it may mis-emit chosen_option_id.
        rec = rec.model_copy(
            update={
                "chosen_option_id": chosen.option_id,
                "next_actions": _execution_ready_actions(rec.next_actions),
            }
        )
        return normalize_recommendation_deadlines(rec, anchor)
    except Exception:
        return normalize_recommendation_deadlines(
            _fallback_recommendation(chosen, composite_by_option_id, memory=memory),
            anchor,
        )
