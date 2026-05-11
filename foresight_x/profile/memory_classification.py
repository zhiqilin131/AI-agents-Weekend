"""Re-bucket memory facts tagged ``other`` for Shadow + personalization ingest.

Prefer a **small structured LLM** call (temperature 0, separate from the main chat model)
when ``OPENAI_API_KEY`` is available and :attr:`Settings.memory_fact_category_llm_refine`
is true. **Deterministic rules** live in :mod:`foresight_x.profile.memory_classification_rules`
(offline / failure fallback + unit tests without a mock LLM)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings, load_settings
from foresight_x.profile.memory_classification_rules import refine_other_with_rules
from foresight_x.schemas import MemoryFactCategory
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)

_CATEGORY_LABELS = Literal["identity", "views", "behavior", "goals", "constraints", "other"]


class _MemoryFactCategoryPick(BaseModel):
    """Structured output for ``other`` → concrete bucket."""

    category: _CATEGORY_LABELS = Field(
        description="Single best bucket for durable profile memory.",
    )
    rationale: str = Field(
        default="",
        max_length=240,
        description="One short phrase for debugging; not shown to end users.",
    )


_MEMORY_CLASSIFY_PROMPT = """You label ONE atomic memory row for a decision-support app profile.
The upstream model was unsure and used category "other". Pick the single best bucket.

Definitions (pick exactly one):
- identity: stable facts about who/where/with whom — relationships, household, school/workplace, names, addresses.
- views: opinions, allegiances, fandom, political/social stance, brand or team loyalty (not food taste).
- behavior: habits, routines, typical actions, food preferences, sleep/exercise patterns.
- goals: stated objectives or wants (things they aim to achieve).
- constraints: hard limits — money, time, legal/health obligations, immovable deadlines.
- other: genuinely ambiguous, purely logistical filler, or none of the above.

Lines (use all non-empty fields):
normalized_text: {text}
user_evidence_quote: {evidence}
predicate: {predicate}
subject_ref: {subject_ref}

Return JSON matching the schema (category + optional short rationale)."""


def _label_to_enum(label: str) -> MemoryFactCategory | None:
    key = (label or "").strip().lower()
    m: dict[str, MemoryFactCategory] = {
        "identity": MemoryFactCategory.IDENTITY,
        "views": MemoryFactCategory.VIEWS,
        "behavior": MemoryFactCategory.BEHAVIOR,
        "goals": MemoryFactCategory.GOALS,
        "constraints": MemoryFactCategory.CONSTRAINTS,
        "other": MemoryFactCategory.OTHER,
    }
    return m.get(key)


def _try_llm_refine_other(
    *,
    text: str,
    evidence: str,
    predicate: str,
    subject_ref: str,
    llm: Any,
) -> MemoryFactCategory | None:
    if llm is None:
        return None
    t = (text or "").strip()[:1200]
    e = (evidence or "").strip()[:600]
    p = (predicate or "").strip()[:200]
    s = (subject_ref or "user").strip()[:120]
    prompt = _MEMORY_CLASSIFY_PROMPT.format(text=t, evidence=e, predicate=p or "(empty)", subject_ref=s)
    try:
        out = structured_predict(llm, _MemoryFactCategoryPick, prompt)
        mapped = _label_to_enum(out.category)
        if mapped is None:
            return None
        return mapped
    except Exception as exc:
        _log.debug("memory category LLM refine failed: %s", exc)
        return None


def refine_memory_category(
    cat: MemoryFactCategory,
    *,
    text: str,
    evidence: str,
    predicate: str,
    subject_ref: str = "user",
    llm: Any | None = None,
    settings: Settings | None = None,
) -> MemoryFactCategory:
    """If ``cat`` is ``other``, prefer structured LLM re-label; else use rule fallback."""
    if cat != MemoryFactCategory.OTHER:
        return cat
    st = settings or load_settings()
    if llm is not None and st.memory_fact_category_llm_refine:
        picked = _try_llm_refine_other(
            text=text,
            evidence=evidence,
            predicate=predicate,
            subject_ref=subject_ref,
            llm=llm,
        )
        if picked is not None and picked != MemoryFactCategory.OTHER:
            return picked
    return refine_other_with_rules(
        text=text,
        evidence=evidence,
        predicate=predicate,
        subject_ref=subject_ref,
    )
