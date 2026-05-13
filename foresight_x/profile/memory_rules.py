"""Principled long-term memory rules and metadata helpers.

The memory layer is for durable, future-useful user context, not a transcript log.

Save when a fact is likely to help future answers or decisions:
- long-term relevance: stable identity, relationships, projects, goals, constraints, preferences, values
- future utility: likely to change recommendations, tone, scheduling, or follow-up questions
- decision-support value: affects trade-offs, risk, workload, plans, or recurring patterns
- recency + importance: recent meaningful updates matter, but trivial momentary details do not
- relational context: connect people, projects, preferences, goals, constraints, and superseded facts

Avoid saving:
- jokes, hypotheticals, roleplay, one-off logistics, transient moods, filler, greetings
- sensitive credentials or secrets
- facts already represented unless the new turn reinforces or updates them
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from foresight_x.profile.memory_structured import normalize_predicate
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact

MEMORY_DECISION_PRINCIPLES: tuple[str, ...] = (
    "long_term_relevance",
    "future_utility",
    "stability_of_preference",
    "decision_support_value",
    "recency",
    "importance",
    "relational_context",
)

_STOP = {
    "about",
    "actually",
    "because",
    "building",
    "context",
    "currently",
    "really",
    "remember",
    "should",
    "thing",
    "things",
    "today",
    "tomorrow",
    "user",
    "with",
    "would",
}

_RELATIONSHIP_PREDS = {
    "dating",
    "partner",
    "girlfriend",
    "boyfriend",
    "friend_of",
    "roommate_of",
    "cofounder_of",
    "manager_of",
    "works_with",
    "classmate_of",
    "related_to",
}

_PROJECT_PREDS = {"builds", "building", "works_on", "project", "founded", "develops", "researches"}
_GOAL_PREDS = {"goal", "wants", "aims_to", "trying_to", "plans_to", "working_toward"}
_CONSTRAINT_PREDS = {"constraint", "limited_by", "deadline", "budget", "time_limit", "blocked_by"}


def memory_rule_summary() -> str:
    return (
        "Save durable, future-useful facts with decision value; avoid jokes, hypotheticals, one-off logistics, "
        "and low-value details; merge or supersede older memories instead of duplicating them."
    )


def _words(text: str) -> list[str]:
    return [
        x.lower()
        for x in re.findall(r"[a-zA-Z][a-zA-Z0-9_'-]{2,}|[\u4e00-\u9fff]{2,}", text or "")
        if x.lower() not in _STOP
    ]


def _parse_ts(raw: str) -> datetime | None:
    t = (raw or "").strip()
    if not t:
        return None
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _recency_score(raw: str) -> float:
    dt = _parse_ts(raw)
    if dt is None:
        return 0.2
    age_days = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0)
    if age_days <= 7:
        return 1.0
    if age_days <= 30:
        return 0.78
    if age_days <= 180:
        return 0.48
    return 0.28


def derive_retrieval_tags(fact: ProfileMemoryFact, *, extra_text: str = "") -> list[str]:
    pred = normalize_predicate(fact.predicate)
    cat = getattr(fact.category, "value", str(fact.category))
    raw = " ".join(
        x
        for x in (
            cat,
            fact.text,
            fact.subject_ref,
            pred.replace("_", " "),
            fact.object_value,
            fact.evidence,
            extra_text,
        )
        if x
    )
    tags: list[str] = [cat]
    if pred:
        tags.append(pred)
    if pred in _RELATIONSHIP_PREDS or any(w in raw.lower() for w in ("girlfriend", "boyfriend", "partner", "roommate")):
        tags.append("relationship")
    if pred in _PROJECT_PREDS or any(w in raw.lower() for w in ("project", "startup", "app", "research", "foresight")):
        tags.append("project")
    if fact.category == MemoryFactCategory.GOALS or pred in _GOAL_PREDS:
        tags.append("goal")
    if fact.category == MemoryFactCategory.CONSTRAINTS or pred in _CONSTRAINT_PREDS:
        tags.append("constraint")
    if fact.category == MemoryFactCategory.VIEWS:
        tags.append("preference")
    for w in _words(raw):
        tags.append(w.strip("_"))
    seen: set[str] = set()
    out: list[str] = []
    for tag in tags:
        t = tag.strip().lower().replace(" ", "_")
        if len(t) < 2 or t in seen:
            continue
        seen.add(t)
        out.append(t[:48])
        if len(out) >= 18:
            break
    return out


def estimate_memory_importance(fact: ProfileMemoryFact) -> float:
    pred = normalize_predicate(fact.predicate)
    text = " ".join([fact.text, pred, fact.object_value, fact.evidence]).lower()
    score = 0.42
    if fact.category == MemoryFactCategory.IDENTITY:
        score += 0.24
    elif fact.category in (MemoryFactCategory.GOALS, MemoryFactCategory.CONSTRAINTS):
        score += 0.2
    elif fact.category == MemoryFactCategory.VIEWS:
        score += 0.14
    elif fact.category == MemoryFactCategory.BEHAVIOR:
        score += 0.1
    if pred in _RELATIONSHIP_PREDS or any(x in text for x in ("girlfriend", "boyfriend", "partner", "roommate")):
        score += 0.16
    if pred in _PROJECT_PREDS or any(x in text for x in ("project", "startup", "research", "hackathon")):
        score += 0.12
    if pred in _GOAL_PREDS or pred in _CONSTRAINT_PREDS:
        score += 0.12
    if any(x in text for x in ("important", "always", "long-term", "deadline", "must", "need to")):
        score += 0.08
    return max(0.0, min(1.0, score))


def infer_memory_relationships(fact: ProfileMemoryFact) -> list[dict[str, Any]]:
    pred = normalize_predicate(fact.predicate)
    obj = (fact.object_value or "").strip()
    rels: list[dict[str, Any]] = []
    if pred and obj:
        rels.append(
            {
                "relation_type": pred,
                "target_ref": obj[:160],
                "target_memory_id": "",
                "evidence": (fact.evidence or fact.text)[:220],
                "confidence": float(fact.confidence or 0.7),
            }
        )
    tags = set(fact.retrieval_tags or derive_retrieval_tags(fact))
    if "goal" in tags and "constraint" in tags:
        rels.append(
            {
                "relation_type": "goal_constrained_by_context",
                "target_ref": "constraint_context",
                "target_memory_id": "",
                "evidence": (fact.evidence or fact.text)[:220],
                "confidence": 0.62,
            }
        )
    return rels[:6]


def enrich_memory_fact(
    fact: ProfileMemoryFact,
    *,
    source_chat: str = "",
    source_thread_id: str = "",
    source_message_id: str = "",
    extra_text: str = "",
) -> ProfileMemoryFact:
    tags = list(dict.fromkeys([*(fact.retrieval_tags or []), *derive_retrieval_tags(fact, extra_text=extra_text)]))
    importance = max(float(fact.importance or 0.0), estimate_memory_importance(fact))
    confidence = float(fact.confidence or 0.7)
    q = dict(fact.qualifiers or {})
    q.setdefault("memory_principles", list(MEMORY_DECISION_PRINCIPLES))
    update: dict[str, Any] = {
        "confidence": max(0.0, min(1.0, confidence)),
        "importance": max(0.0, min(1.0, importance)),
        "retrieval_tags": tags[:18],
        "qualifiers": q,
    }
    if source_chat and not fact.source_chat:
        update["source_chat"] = source_chat[:80]
    if source_thread_id and not fact.source_thread_id:
        update["source_thread_id"] = source_thread_id[:120]
    if source_message_id and not fact.source_message_id:
        update["source_message_id"] = source_message_id[:120]
    enriched = fact.model_copy(update=update)
    if not enriched.relationships:
        enriched = enriched.model_copy(update={"relationships": infer_memory_relationships(enriched)})
    return enriched


def rank_memory_facts_for_query(facts: list[ProfileMemoryFact], query: str, *, limit: int = 32) -> list[ProfileMemoryFact]:
    q_words = set(_words(query))

    def score(f: ProfileMemoryFact) -> float:
        blob = " ".join(
            [
                f.text or "",
                f.subject_ref or "",
                f.predicate or "",
                f.object_value or "",
                f.evidence or "",
                " ".join(f.retrieval_tags or []),
            ]
        )
        fw = set(_words(blob))
        overlap = len(q_words & fw) / max(1, len(q_words)) if q_words else 0.0
        importance = float(f.importance or estimate_memory_importance(f))
        recency = _recency_score(f.last_reinforced_at or f.updated_at or f.created_at)
        relation = 0.08 if f.relationships or f.related_memory_ids or f.object_value else 0.0
        return 0.52 * overlap + 0.28 * importance + 0.12 * recency + relation

    ranked = sorted(facts, key=score, reverse=True)
    return ranked[:limit]
