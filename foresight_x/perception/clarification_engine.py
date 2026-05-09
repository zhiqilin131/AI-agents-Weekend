"""Smart clarification via LLM — bounded latency (thread pool + timeout)."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any

from foresight_x.schemas import UserProfile

from foresight_x.perception.clarify_types import ClarifyGateResult, StructuredPredictLLM
from foresight_x.perception.personalized_clarify import run_personalized_clarify_gate


def run_personalized_clarify_gate_timed(
    raw: str,
    llm: StructuredPredictLLM | None,
    *,
    timeout_s: float = 1.5,
    profile: UserProfile | None = None,
    recent_messages: list[dict[str, str]] | None = None,
    thread_clarification_events: list[dict[str, Any]] | None = None,
    interaction_purpose: str | None = None,
) -> tuple[ClarifyGateResult | None, float | None]:
    """
    Run personalized clarification in a worker thread; returns None on timeout/error.
    Second return value is LLM wall time in ms, or None if skipped (no LLM).
    """
    if llm is None:
        return None, None
    t0 = time.perf_counter()

    def _work() -> ClarifyGateResult:
        return run_personalized_clarify_gate(
            raw,
            llm,
            profile=profile,
            recent_messages=recent_messages or [],
            thread_clarification_events=thread_clarification_events or [],
            interaction_purpose=interaction_purpose,
        )

    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(_work)
        try:
            out = fut.result(timeout=timeout_s)
            ms = (time.perf_counter() - t0) * 1000.0
            return out, round(ms, 3)
        except FuturesTimeout:
            ms = (time.perf_counter() - t0) * 1000.0
            return None, round(ms, 3)
        except Exception:
            ms = (time.perf_counter() - t0) * 1000.0
            return None, round(ms, 3)
