"""Tavily search wrapper -> `Fact` for `EvidenceBundle.recent_events` (use mocks in tests)."""

from __future__ import annotations

from typing import Any, Protocol

from tavily import TavilyClient

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import Fact

# https://docs.tavily.com/ — API rejects queries over 400 characters.
TAVILY_MAX_QUERY_CHARS = 400


def _truncate_tavily_query(q: str) -> str:
    s = (q or "").strip()
    if len(s) <= TAVILY_MAX_QUERY_CHARS:
        return s
    return s[: TAVILY_MAX_QUERY_CHARS - 1].rstrip() + "…"


class TavilySearchClient(Protocol):
    """Subset of `tavily.TavilyClient` used by `TavilyGateway`."""

    def search(self, query: str, **kwargs: Any) -> dict[str, Any]:
        ...


class TavilyGateway:
    """Thin layer over Tavily; tests patch `TavilyClient` — no live key required in CI."""

    def __init__(
        self,
        api_key: str,
        max_results: int = 5,
        *,
        search_depth: str = "advanced",
    ) -> None:
        if not api_key:
            raise ValueError("TAVILY_API_KEY is required for TavilyGateway")
        self._client: TavilySearchClient = TavilyClient(api_key)
        self._max_results = max_results
        self._search_depth = search_depth

    def search_as_facts(
        self,
        query: str,
        *,
        max_results: int | None = None,
        confidence: float = 0.75,
        search_depth: str | None = None,
    ) -> list[Fact]:
        safe_q = _truncate_tavily_query(query)
        payload = self._client.search(
            safe_q,
            max_results=max_results or self._max_results,
            search_depth=search_depth or self._search_depth,
        )
        rows = payload.get("results") or []
        facts: list[Fact] = []
        for row in rows:
            title = (row.get("title") or "").strip()
            body = (row.get("content") or row.get("raw_content") or "").strip()
            url = row.get("url")
            text = f"{title}\n{body}".strip() if title else body
            if not text:
                continue
            facts.append(
                Fact(
                    text=text[:8000],
                    source_url=str(url) if url else None,
                    confidence=confidence,
                )
            )
        return facts


def build_tavily_gateway(settings: Settings | None = None) -> TavilyGateway:
    """Build gateway from `TAVILY_API_KEY` and optional `TAVILY_SEARCH_DEPTH` in settings."""
    s = settings or load_settings()
    return TavilyGateway(
        s.tavily_api_key,
        search_depth=s.tavily_search_depth,
    )
