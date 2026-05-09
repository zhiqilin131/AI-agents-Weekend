"""Resource drops for recommendation card — internal actions + optional Tavily URLs."""

from __future__ import annotations

import hashlib
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings, load_settings
from foresight_x.resources.tavily_resources import (
    build_tavily_resource_queries,
    fact_to_search_result_drop,
    search_queries_as_ranked_facts,
    should_skip_external_resources,
)
from foresight_x.retrieval.tavily_client import TavilyGateway, build_tavily_gateway
from foresight_x.schemas import DecisionTrace, Recommendation


ResourceActionType = Literal[
    "website",
    "official_page",
    "tool",
    "template",
    "calendar",
    "internal_action",
    "search_result",
]
ResourceSource = Literal["tavily", "curated", "internal"]


class ResourceDrop(BaseModel):
    id: str
    title: str
    description: str
    url: str | None = None
    action_type: ResourceActionType
    source: ResourceSource
    relevance_reason: str = ""
    confidence: float = Field(ge=0.0, le=1.0, default=0.75)
    domain: str | None = None


INTERNAL_CALENDAR_ID = "internal_execution_calendar"


def _stable_id(url: str, title: str) -> str:
    h = hashlib.sha256(f"{url}|{title}".encode()).hexdigest()[:12]
    return f"rd_{h}"


def _internal_calendar_drop(trace: DecisionTrace, recommendation: Recommendation | None = None) -> ResourceDrop | None:
    rec = recommendation or trace.recommendation
    if not rec.next_actions:
        return None
    return ResourceDrop(
        id=INTERNAL_CALENDAR_ID,
        title="Create Execution Calendar",
        description="Turn recommended next steps into scheduled blocks.",
        url=None,
        action_type="calendar",
        source="internal",
        relevance_reason="Maps your report actions onto a concrete calendar plan.",
        confidence=1.0,
        domain=None,
    )


def calendar_fallback_drops(trace: DecisionTrace, recommendation: Recommendation | None = None) -> list[ResourceDrop]:
    """Internal-only rows when Tavily or ranking fails."""
    cal = _internal_calendar_drop(trace, recommendation=recommendation)
    return [cal] if cal else []


def generate_resource_drops_for_recommendation(
    trace: DecisionTrace,
    recommendation: Recommendation | None = None,
    *,
    max_items: int = 4,
    settings: Settings | None = None,
    tavily: TavilyGateway | None = None,
) -> list[ResourceDrop]:
    """
    Useful clickable resources for the recommendation.

    Rules:
    - Always include internal execution calendar when next_actions exist.
    - Tavily only when configured and topic warrants external links.
    - Never invent URLs — external rows come only from Tavily (or curated expansions below).
    """
    s = settings or load_settings()
    out: list[ResourceDrop] = []

    cal = _internal_calendar_drop(trace, recommendation=recommendation)
    if cal:
        out.append(cal)

    if should_skip_external_resources(trace):
        return out[:max_items]

    gateway = tavily
    if gateway is None and (s.tavily_api_key or "").strip():
        try:
            gateway = build_tavily_gateway(s)
        except Exception:
            gateway = None

    if gateway is None:
        return out[:max_items]

    queries = build_tavily_resource_queries(trace)
    if not queries:
        return out[:max_items]

    raw_user = trace.original_user_input or trace.user_state.raw_input or ""
    sensitive = any(
        k in raw_user.lower()
        for k in ("visa", "immigration", "cpt", "opt", "law", "legal", "irs", "tax court")
    )

    ranked = search_queries_as_ranked_facts(
        gateway,
        queries,
        raw_user=raw_user,
        sensitive_topic=sensitive,
        max_keep=max_items,
    )

    external_budget = max(0, max_items - len(out))
    taken = 0
    min_accept = 0.42 if sensitive else 0.28
    for score, fact, qused in ranked:
        if taken >= external_budget:
            break
        if score < min_accept:
            continue
        d = fact_to_search_result_drop(
            fact,
            relevance_reason=f"Matched your topic via: {qused[:120]}",
            confidence=min(1.0, 0.55 + score * 0.35),
            domain=None,
        )
        drop = ResourceDrop(
            id=_stable_id(d["url"] or "", d["title"]),
            title=d["title"],
            description=d["description"],
            url=d["url"],
            action_type=d["action_type"],  # type: ignore[arg-type]
            source="tavily",
            relevance_reason=d["relevance_reason"],
            confidence=d["confidence"],
            domain=d["domain"],
        )
        if drop.url and not any(x.url == drop.url for x in out):
            out.append(drop)
            taken += 1

    return out[:max_items]


def resource_drops_as_json(drops: list[ResourceDrop]) -> list[dict[str, Any]]:
    return [d.model_dump(mode="json") for d in drops]
