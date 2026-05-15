"""Build Slime Buddy memory evidence chips from profile facts and text snippets."""

from __future__ import annotations

import uuid
from typing import Any

from foresight_x.schemas import ProfileMemoryFact
from foresight_x.voice.slime_memory_synthesis import MemoryEvidenceItem, evidence_items_from_hits

_MAX_EVIDENCE = 8


def evidence_items_from_text_snippets(
    texts: list[str],
    *,
    label: str = "Used memory",
    evidence_type: str = "memory",
    base_confidence: float = 0.64,
) -> list[dict[str, Any]]:
    """Compact chips from plain fact strings (preference grounding, legacy paths)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for text in texts[:_MAX_EVIDENCE]:
        t = " ".join(str(text or "").split())
        if len(t) < 4:
            continue
        key = t.lower()[:120]
        if key in seen:
            continue
        seen.add(key)
        short = t[:64] + "…" if len(t) > 67 else t
        out.append(
            MemoryEvidenceItem(
                id=f"mem-{uuid.uuid4().hex[:8]}",
                type=evidence_type,  # type: ignore[arg-type]
                label=label,
                shortText=short,
                fullText=t[:900],
                confidence=base_confidence,
            ).model_dump(mode="json")
        )
    return out


def evidence_items_from_profile_facts(
    facts: list[ProfileMemoryFact],
    *,
    label: str = "Profile memory",
    limit: int = _MAX_EVIDENCE,
) -> list[dict[str, Any]]:
    """Structured profile facts retrieved for this turn (ranked memory)."""
    hits: list[dict[str, Any]] = []
    for i, fact in enumerate(facts[:limit]):
        text = (fact.text or "").strip()
        if not text:
            continue
        hits.append(
            {
                "kind": "memory_fact",
                "id": fact.id or f"fact-{i}",
                "text": text,
                "category": str(fact.category.value if hasattr(fact.category, "value") else fact.category),
                "importance": fact.importance,
                "created_at": fact.created_at,
                "updated_at": fact.updated_at,
                "last_reinforced_at": fact.last_reinforced_at,
                "rank_score": 0.85,
            }
        )
    items = evidence_items_from_hits(hits)
    if label != "Memory":
        for row in items:
            row.label = label
    return [e.model_dump(mode="json") for e in items]


def merge_evidence_items(*groups: list[dict[str, Any]], limit: int = _MAX_EVIDENCE) -> list[dict[str, Any]]:
    """Dedupe evidence rows by id then fullText prefix."""
    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_text: set[str] = set()
    for group in groups:
        for row in group:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or "").strip()
            full = " ".join(str(row.get("fullText") or row.get("shortText") or "").split()).lower()[:160]
            if rid and rid in seen_ids:
                continue
            if full and full in seen_text:
                continue
            if rid:
                seen_ids.add(rid)
            if full:
                seen_text.add(full)
            out.append(row)
            if len(out) >= limit:
                return out
    return out


def build_turn_memory_evidence(
    *,
    retrieved_facts: list[ProfileMemoryFact] | None = None,
    used_text_facts: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Unified evidence list for a shadow/slime conversation turn."""
    from_profile = evidence_items_from_profile_facts(list(retrieved_facts or []))
    from_text = evidence_items_from_text_snippets(list(used_text_facts or []))
    return merge_evidence_items(from_profile, from_text)
