"""Comparative (cross-option) elicitation: rank options → per-option feature levels."""

from __future__ import annotations

from foresight_x.schemas import Option
from foresight_x.simulation.feature_registry import (
    COST_FEATURES,
    FEATURE_LABELS,
    FEATURE_VOI_PRIOR,
    comparative_priority_keys,
    is_cost_feature,
)
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    FeatureLevel,
    OptionFeatureVector,
    ScoringClarifyQuestion,
)

MAX_COMPARATIVE_QUESTIONS = 2


def comparative_question_id(feature_key: str) -> str:
    return f"cmp:{feature_key}:rank"


def feature_key_from_comparative_id(qid: str) -> str | None:
    if not qid.startswith("cmp:") or not qid.endswith(":rank"):
        return None
    inner = qid[4:-5]
    return inner if inner in CRITICAL_FEATURE_KEYS else None


def _missing_across_options(
    feature_vectors: list[OptionFeatureVector],
    feature_key: str,
) -> bool:
    """True when at least two options lack known status on this feature."""
    unknown_count = 0
    for fv in feature_vectors:
        st = (fv.field_status or {}).get(feature_key, "unknown")
        val = getattr(fv, feature_key, "unknown")
        if st != "known" or val == "unknown":
            unknown_count += 1
    return unknown_count >= 2


def rank_to_levels(
    ordered_option_ids: list[str],
    feature_key: str,
) -> dict[str, FeatureLevel]:
    """Map a total-order rank (best/highest first) to low/medium/high per option."""
    n = len(ordered_option_ids)
    if n == 0:
        return {}
    out: dict[str, FeatureLevel] = {}
    for i, oid in enumerate(ordered_option_ids):
        if n == 1:
            level: FeatureLevel = "medium"
        elif n == 2:
            level = "high" if i == 0 else "low"
        elif i == 0:
            level = "high"
        elif i == n - 1:
            level = "low"
        else:
            level = "medium"
        out[oid] = level
    return out


def comparative_to_scoring_clarification(
    comparative_answers: dict[str, list[str]],
) -> dict[str, str]:
    """Expand cmp:{feature}:rank → {option_id}:{feature} level answers."""
    out: dict[str, str] = {}
    for qid, rank in comparative_answers.items():
        fkey = feature_key_from_comparative_id(qid)
        if not fkey or not rank:
            continue
        levels = rank_to_levels(rank, fkey)
        for oid, lv in levels.items():
            out[f"{oid}:{fkey}"] = lv
    return out


def build_comparative_questions(
    options: list[Option],
    feature_vectors: list[OptionFeatureVector],
    *,
    max_questions: int = MAX_COMPARATIVE_QUESTIONS,
    existing_comparative: dict[str, list[str]] | None = None,
) -> list[ScoringClarifyQuestion]:
    """Build cross-option rank questions for features with low discrimination / unknown."""
    if len(options) < 2:
        return []
    names = {o.option_id: o.name for o in options}
    option_ids = [o.option_id for o in options]
    priority = comparative_priority_keys(feature_vectors, missing_only=True)
    questions: list[ScoringClarifyQuestion] = []
    for fkey in priority:
        qid = comparative_question_id(fkey)
        if existing_comparative and qid in existing_comparative:
            continue
        if not _missing_across_options(feature_vectors, fkey):
            continue
        label = FEATURE_LABELS.get(fkey, fkey.replace("_level", ""))
        if fkey in COST_FEATURES or is_cost_feature(fkey):
            prompt = (
                f"Rank these options by {label} — most to least "
                f"(which takes the most {label} at the top?):"
            )
        else:
            prompt = (
                f"Rank these options by {label} — highest to lowest "
                f"(best / strongest at the top):"
            )
        voi = FEATURE_VOI_PRIOR.get(fkey, 0.5)
        questions.append(
            ScoringClarifyQuestion(
                id=qid,
                feature_key=fkey,
                option_id=None,
                prompt=prompt,
                answer_type="rank",
                choices=list(option_ids),
                voi_score=round(voi, 3),
            )
        )
        if len(questions) >= max_questions:
            break
    enriched: list[ScoringClarifyQuestion] = []
    for q in questions:
        lines = [f"• {names.get(oid, oid)}" for oid in option_ids]
        enriched.append(
            q.model_copy(update={"prompt": q.prompt + "\n" + "\n".join(lines)})
        )
    return enriched
