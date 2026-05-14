"""Heuristic extraction from traces into event/concept graph nodes."""

from __future__ import annotations

import re
from dataclasses import dataclass

from foresight_x.memory_graph.models import GraphNode
from foresight_x.schemas import DecisionOutcome, DecisionTrace, UserState


@dataclass
class ConceptLink:
    concept_id: str
    concept_type: str
    label: str
    edge_type: str
    weight: float
    confidence: float


EMOTION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "grief": ("grief", "heartbreak", "breakup", "loss"),
    "anxiety": ("anxiety", "anxious", "worry", "worried", "panic"),
    "stress": ("stress", "overwhelmed", "burnout"),
    "relief": ("relief", "relieved"),
    "excitement": ("excited", "exciting", "thrilled"),
}


RELATIONSHIP_KEYWORDS: dict[str, tuple[str, ...]] = {
    "ex_partner": ("ex", "ex-boyfriend", "ex-girlfriend", "former partner"),
    "friend": ("friend", "friends"),
    "partner": ("partner", "boyfriend", "girlfriend", "relationship"),
    "family": ("mom", "mother", "dad", "father", "family", "parents"),
}

MAX_GOAL_LINKS = 8
MAX_VALUE_LINKS = 8
MAX_PRIORITY_LINKS = 10
MAX_PERSON_LINKS = 8
MAX_TOTAL_LINKS = 24
MAX_MEMORY_FACT_LINKS = 14

STOPWORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "for",
    "in",
    "on",
    "at",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "with",
    "this",
    "that",
    "it",
    "my",
    "me",
    "we",
    "our",
    "you",
    "your",
}

SAFETY_QUERY_KEYWORDS = {
    "allergy",
    "allergic",
    "food",
    "diet",
    "eat",
    "eating",
    "meal",
    "meals",
    "restaurant",
    "seafood",
    "salmon",
    "fish",
    "nutrition",
    "health",
    "medical",
    "avoid",
}


def _slug(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]+", "_", text.strip().lower()).strip("_")[:80]


def _tokenize(text: str) -> set[str]:
    out = {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text or "")}
    return {w for w in out if w not in STOPWORDS}


def _overlap_score(lhs: set[str], rhs: set[str]) -> float:
    if not lhs or not rhs:
        return 0.0
    inter = len(lhs & rhs)
    if inter <= 0:
        return 0.0
    return inter / max(2.0, len(rhs) * 0.8)


def _extract_people(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    blacklist = {
        "should",
        "could",
        "would",
        "will",
        "can",
        "is",
        "are",
        "my",
        "our",
        "their",
    }
    for candidate in re.findall(r"\b[A-Z][a-z]{1,24}\b", text or ""):
        if candidate.lower() in ("i", "im", "ive", "you", "we", "it"):
            continue
        if candidate.lower() in blacklist:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        out.append(candidate)
    return out[:10]


def concept_links_from_user_state(user_state: UserState) -> list[ConceptLink]:
    context_text = " ".join(
        [
            user_state.raw_input or "",
            " ".join(user_state.goals or []),
            user_state.current_behavior or "",
            user_state.decision_type or "",
            (user_state.deadline_hint or ""),
        ]
    )
    query_tokens = _tokenize(context_text)
    query_mentions_safety = any(tok in SAFETY_QUERY_KEYWORDS for tok in query_tokens)
    if (user_state.decision_type or "").strip().lower() in {"health", "medical", "nutrition"}:
        query_mentions_safety = True
    links: list[ConceptLink] = []

    for g in user_state.goals[:MAX_GOAL_LINKS]:
        if not g.strip():
            continue
        gid = f"concept:value:{_slug(g)}"
        links.append(ConceptLink(gid, "value", g.strip(), "supports_goal", 0.82, 0.9))

    for v in user_state.profile_values[:MAX_VALUE_LINKS]:
        if not v.strip():
            continue
        ov = _overlap_score(_tokenize(v), query_tokens)
        if ov <= 0:
            continue
        vid = f"concept:value:{_slug(v)}"
        links.append(ConceptLink(vid, "value", v.strip(), "anchored_value", 0.78 + 0.2 * ov, 0.95))

    for line in user_state.profile_user_priorities[:MAX_PRIORITY_LINKS]:
        ll = line.strip()
        if not ll:
            continue
        ov = _overlap_score(_tokenize(ll), query_tokens)
        if ov <= 0:
            continue
        bid = f"concept:belief:{_slug(ll)}"
        links.append(ConceptLink(bid, "belief", ll, "stated_priority", 0.68 + 0.24 * ov, 0.88))

    for label, kws in EMOTION_KEYWORDS.items():
        if any(k in query_tokens for k in kws):
            nid = f"concept:emotion:{_slug(label)}"
            links.append(ConceptLink(nid, "emotion", label, "felt_emotion", 0.72, 0.8))

    for label, kws in RELATIONSHIP_KEYWORDS.items():
        if any(k in query_tokens for k in kws):
            nid = f"concept:relationship:{_slug(label)}"
            links.append(ConceptLink(nid, "relationship", label, "relationship_context", 0.7, 0.82))

    for person in _extract_people(user_state.raw_input)[:MAX_PERSON_LINKS]:
        nid = f"concept:person:{_slug(person)}"
        links.append(ConceptLink(nid, "person", person, "mentions_person", 0.68, 0.76))

    # Bring in structured shadow/profile memory facts, but only when relevant to this query.
    fact_candidates: list[tuple[float, ConceptLink]] = []
    for fact in user_state.profile_memory_facts[:60]:
        if getattr(fact, "status", "active") == "deprecated":
            continue
        subj = (fact.subject_ref or "user").strip() or "user"
        pred = (fact.predicate or "").strip()
        obj = (fact.object_value or "").strip()
        text = (fact.text or "").strip()
        label = " | ".join(x for x in [subj, pred, obj] if x).strip() or text
        if not label:
            continue
        f_tokens = _tokenize(" ".join([subj, pred, obj, text]))
        ov = _overlap_score(f_tokens, query_tokens)
        safety_constraint = any(x in f_tokens for x in ("allergy", "allergic", "seafood", "constraint", "avoid"))
        if ov <= 0:
            # Keep broad safety facts only when the current question is explicitly safety/food related.
            if not (safety_constraint and query_mentions_safety):
                continue

        cat_raw = getattr(fact, "category", "other")
        cat = str(getattr(cat_raw, "value", cat_raw)).lower()
        ctype_map = {
            "identity": "identity",
            "views": "belief",
            "behavior": "behavior",
            "goals": "value",
            "constraints": "constraint",
            "other": "belief",
        }
        ctype = ctype_map.get(cat, "belief")
        cid = f"concept:{ctype}:{_slug(label)}"
        weight = 0.66 + 0.3 * ov
        if safety_constraint and query_mentions_safety:
            weight = max(weight, 0.82)
        fact_candidates.append(
            (
                weight,
                ConceptLink(
                    cid,
                    ctype,
                    label[:140],
                    "memory_fact_context",
                    min(0.98, weight),
                    float(getattr(fact, "confidence", 0.9) or 0.9),
                ),
            )
        )
    fact_candidates.sort(key=lambda x: x[0], reverse=True)
    links.extend(link for _, link in fact_candidates[:MAX_MEMORY_FACT_LINKS])

    # De-duplicate by concept ID, keep highest-weight relation.
    best: dict[str, ConceptLink] = {}
    for link in links:
        cur = best.get(link.concept_id)
        if cur is None or link.weight > cur.weight:
            best[link.concept_id] = link
    out = list(best.values())
    out.sort(key=lambda x: x.weight, reverse=True)
    return out[:MAX_TOTAL_LINKS]


def decision_event_node(trace: DecisionTrace) -> GraphNode:
    label = f"Decision {trace.decision_id[:8]} ({trace.user_state.decision_type})"
    return GraphNode(
        node_id=f"event:decision:{trace.decision_id}",
        layer="event",
        node_type="decision",
        label=label,
        created_at=trace.timestamp,
        metadata={"decision_id": trace.decision_id, "decision_type": trace.user_state.decision_type},
    )


def outcome_event_node(trace: DecisionTrace, outcome: DecisionOutcome) -> GraphNode:
    label = f"Outcome for {trace.decision_id[:8]} (q={outcome.user_reported_quality})"
    return GraphNode(
        node_id=f"event:outcome:{trace.decision_id}:{_slug(outcome.timestamp)}",
        layer="event",
        node_type="outcome",
        label=label,
        created_at=outcome.timestamp,
        metadata={
            "decision_id": trace.decision_id,
            "user_reported_quality": outcome.user_reported_quality,
            "reversed_later": outcome.reversed_later,
        },
    )
