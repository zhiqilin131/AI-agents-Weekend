"""Tavily search wrapper -> `Fact` for `EvidenceBundle.recent_events` (use mocks in tests)."""

from __future__ import annotations

import time
from typing import Any, Protocol

from tavily import TavilyClient

from foresight_x.config import Settings, load_settings
from foresight_x.resilience.runtime import (
    chaos_mode,
    circuit_allow,
    circuit_record,
    degrade,
    record_provider_call,
)
from foresight_x.schemas import Fact, UserState

# https://docs.tavily.com/ — API rejects queries over 400 characters.
TAVILY_MAX_QUERY_CHARS = 400


def _truncate_tavily_query(q: str) -> str:
    s = (q or "").strip()
    if len(s) <= TAVILY_MAX_QUERY_CHARS:
        return s
    return s[: TAVILY_MAX_QUERY_CHARS - 1].rstrip() + "…"


def build_tavily_query_for_decision(user_state: UserState, profile_extra: str = "") -> str:
    """Build a Tavily query aligned to *this* decision.

    Puts the user's actual question first so live search is not dominated by profile text or old
    demo embeddings. Chroma retrieval may still use a broader query string separately.
    """
    raw = (user_state.raw_input or "").strip()
    goals = " ".join((user_state.goals or [])[:12])
    dt = (user_state.decision_type or "general").strip()
    prof = (profile_extra or "").strip()
    if len(prof) > 260:
        prof = prof[:257] + "..."
    parts: list[str] = []
    if raw:
        parts.append(raw)
    if goals:
        parts.append(goals)
    if dt and dt != "general":
        parts.append(dt)
    if prof:
        parts.append(prof)
    q = " ".join(parts) if parts else raw or goals or dt
    return _truncate_tavily_query(q)


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
        settings: Settings | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("TAVILY_API_KEY is required for TavilyGateway")
        self._client: TavilySearchClient = TavilyClient(api_key)
        self._max_results = max_results
        self._search_depth = search_depth
        self._settings = settings or load_settings()

    def search_as_facts(
        self,
        query: str,
        *,
        max_results: int | None = None,
        confidence: float = 0.75,
        search_depth: str | None = None,
    ) -> list[Fact]:
        provider = "tavily"
        s = self._settings
        if not circuit_allow(
            provider,
            failure_threshold=s.resilience_circuit_failure_threshold,
            open_seconds=s.resilience_circuit_open_sec,
        ):
            degrade(
                component=provider,
                reason="circuit breaker open; using cache-only world knowledge",
                stage="retrieve",
                retryable=True,
                error_kind="circuit_open",
            )
            return []
        mode = chaos_mode("tavily")
        if mode in ("outage", "timeout", "5xx"):
            degrade(
                component=provider,
                reason=f"chaos injection active ({mode}); using cache-only world knowledge",
                stage="retrieve",
                retryable=True,
                error_kind=mode,
            )
            circuit_record(provider, ok=False)
            return []

        safe_q = _truncate_tavily_query(query)
        attempts = max(1, int(s.resilience_retry_attempts))
        backoff_ms = max(0, int(s.resilience_retry_backoff_ms))
        payload: dict[str, Any] = {}
        ok = False
        err_kind = ""
        for i in range(attempts):
            t0 = time.perf_counter()
            try:
                payload = self._client.search(
                    safe_q,
                    max_results=max_results or self._max_results,
                    search_depth=search_depth or self._search_depth,
                )
                ok = True
                latency_ms = (time.perf_counter() - t0) * 1000.0
                circuit_record(provider, ok=True)
                record_provider_call(
                    provider,
                    ok=True,
                    latency_ms=latency_ms,
                    brownout_threshold_ms=float(s.resilience_brownout_latency_ms),
                )
                break
            except Exception as exc:
                latency_ms = (time.perf_counter() - t0) * 1000.0
                err_kind = type(exc).__name__
                circuit_record(provider, ok=False)
                record_provider_call(
                    provider,
                    ok=False,
                    latency_ms=latency_ms,
                    brownout_threshold_ms=float(s.resilience_brownout_latency_ms),
                    error_kind=err_kind,
                )
                if i + 1 < attempts:
                    degrade(
                        component=provider,
                        reason=f"search failed; retry {i + 1}/{attempts - 1}",
                        stage="retrieve",
                        retryable=True,
                        error_kind=err_kind,
                    )
                    if backoff_ms > 0:
                        time.sleep((backoff_ms * (2**i)) / 1000.0)
                    continue
                degrade(
                    component=provider,
                    reason="search failed; degrading to cache-only evidence",
                    stage="retrieve",
                    retryable=True,
                    error_kind=err_kind,
                )
                return []
        if not ok:
            return []
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
        settings=s,
    )
