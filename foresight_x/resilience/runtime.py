"""Runtime resilience primitives: retries, circuit state, brown-out and run-local events."""

from __future__ import annotations

import os
import threading
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_run_events_var: ContextVar[list[dict[str, Any]] | None] = ContextVar("fx_resilience_run_events", default=None)
_tls_run_events = threading.local()


def _active_run_buffer() -> list[dict[str, Any]] | None:
    cur = _run_events_var.get()
    if cur is not None:
        return cur
    buf = getattr(_tls_run_events, "run_events", None)
    return buf if isinstance(buf, list) else None


def start_resilience_run() -> tuple[object, list[dict[str, Any]]]:
    """Begin a run-scoped resilience event list.

    Returns ``(context_token, mutable_buffer)``. Keep the buffer reference for
    finalize/SSE paths where ContextVar tokens may not reset across yields.
    """
    events: list[dict[str, Any]] = []
    token = _run_events_var.set(events)
    _tls_run_events.run_events = events
    return token, events


def end_resilience_run(
    token: object,
    *,
    buffer: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Finish run-scoped collection and restore prior context."""
    if buffer is not None:
        events = list(buffer)
    else:
        events = list(_active_run_buffer() or [])
    try:
        _run_events_var.reset(token)  # type: ignore[arg-type]
    except ValueError:
        # Starlette/FastAPI SSE generators often resume in a different Context.
        _run_events_var.set(None)
    if getattr(_tls_run_events, "run_events", None) is not None:
        _tls_run_events.run_events = None
    return events


def current_run_events() -> list[dict[str, Any]]:
    buf = _active_run_buffer()
    return list(buf) if buf is not None else []


def _append_run_event(ev: dict[str, Any]) -> None:
    buf = _active_run_buffer()
    if buf is None:
        return
    buf.append(ev)


_LOCK = threading.Lock()
_PROVIDER_STATS: dict[str, dict[str, float]] = {}


def reset_resilience_runtime_state() -> None:
    """Testing helper: clear global counters and breaker state."""
    from foresight_x.orchestration.circuit_breaker import reset_all_breakers

    with _LOCK:
        _PROVIDER_STATS.clear()
    reset_all_breakers()


def _provider_stat_row(provider: str) -> dict[str, float]:
    with _LOCK:
        row = _PROVIDER_STATS.get(provider)
        if row is None:
            row = {
                "calls_total": 0.0,
                "ok_total": 0.0,
                "error_total": 0.0,
                "brownout_total": 0.0,
                "last_latency_ms": 0.0,
            }
            _PROVIDER_STATS[provider] = row
        return row


def circuit_allow(provider: str, *, failure_threshold: int, open_seconds: float) -> bool:
    from foresight_x.orchestration.circuit_breaker import circuit_allow as _allow

    return _allow(
        provider,
        failure_threshold=failure_threshold,
        open_seconds=open_seconds,
    )


def circuit_record(provider: str, *, ok: bool) -> None:
    from foresight_x.orchestration.circuit_breaker import circuit_record as _record

    _record(provider, ok=ok)


def record_provider_call(
    provider: str,
    *,
    ok: bool,
    latency_ms: float,
    brownout_threshold_ms: float,
    error_kind: str = "",
) -> None:
    row = _provider_stat_row(provider)
    row["calls_total"] += 1.0
    row["last_latency_ms"] = float(max(0.0, latency_ms))
    if ok:
        row["ok_total"] += 1.0
    else:
        row["error_total"] += 1.0
    if latency_ms >= max(1.0, brownout_threshold_ms):
        row["brownout_total"] += 1.0
        degrade(
            component=provider,
            reason=f"brownout latency {latency_ms:.0f}ms",
            stage="runtime",
            retryable=True,
            error_kind="brownout",
        )
    # Failed calls are tracked in stats only; do not mark the run degraded when a
    # later retry/failover succeeds (e.g. ValidationError on primary OpenAI).


def degrade(
    *,
    component: str,
    reason: str,
    stage: str = "",
    retryable: bool = True,
    error_kind: str = "",
    provider: str = "",
    fallback_path: str = "",
) -> dict[str, Any]:
    ev = {
        "at": _utc_now(),
        "component": (component or "runtime").strip()[:80],
        "stage": (stage or "").strip()[:64],
        "reason": (reason or "degraded").strip()[:240],
        "retryable": bool(retryable),
        "error_kind": (error_kind or "").strip()[:80],
        "provider": (provider or "").strip()[:80],
        "fallback_path": (fallback_path or "").strip()[:120],
    }
    _append_run_event(ev)
    return ev


def chaos_mode(provider: str) -> str:
    from foresight_x.orchestration.chaos import chaos_mode as _chaos_mode

    return _chaos_mode(provider)


def probe_linear_mcp() -> None:
    """Record Linear MCP availability signal for this run (non-blocking)."""
    from foresight_x.orchestration.circuit_breaker import BREAKER_MCP_LINEAR, breaker_before_call
    from foresight_x.orchestration.chaos import TARGET_MCP_LINEAR, DependencyDegraded, get_profile, maybe_raise

    try:
        maybe_raise(TARGET_MCP_LINEAR)
    except Exception:
        pass
    try:
        breaker_before_call(BREAKER_MCP_LINEAR)
    except DependencyDegraded:
        degrade(
            component="linear_mcp",
            reason="circuit breaker open; continuing without MCP assist",
            stage="infra_probe",
            retryable=True,
            error_kind="circuit_open",
        )
        return
    mode = chaos_mode("linear_mcp")
    profile = get_profile(TARGET_MCP_LINEAR)
    if profile is not None or mode in ("outage", "timeout", "5xx"):
        err = mode or (profile.legacy_mode() if profile else "outage")
        record_provider_call(
            "linear_mcp",
            ok=False,
            latency_ms=0.0,
            brownout_threshold_ms=10_000.0,
            error_kind=err,
        )
        degrade(
            component="linear_mcp",
            reason="Linear MCP unavailable; continuing without MCP assist",
            stage="infra_probe",
            retryable=True,
            error_kind=err,
        )
        return
    record_provider_call(
        "linear_mcp",
        ok=True,
        latency_ms=1.0,
        brownout_threshold_ms=10_000.0,
    )


def resilience_health_report() -> dict[str, Any]:
    from foresight_x.orchestration.circuit_breaker import get_resilience_snapshot

    with _LOCK:
        stats = {k: dict(v) for k, v in _PROVIDER_STATS.items()}
    snap = get_resilience_snapshot()
    breaker_view = snap.get("breakers") or {}
    return {
        "status": "ok",
        "generated_at": _utc_now(),
        "providers": stats,
        "circuit_breakers": breaker_view,
        "chaos_modes": {
            "openai": chaos_mode("openai"),
            "tavily": chaos_mode("tavily"),
            "linear_mcp": chaos_mode("linear_mcp"),
        },
    }


def breaker_states_snapshot() -> dict[str, Any]:
    """Return a copy of current breaker states for trace runtime metadata."""
    from foresight_x.orchestration.circuit_breaker import breaker_states_snapshot as _snap

    return _snap()


def chaos_profile_snapshot() -> dict[str, str]:
    """Snapshot active chaos profile for provider/runtime diagnostics."""
    from foresight_x.orchestration.chaos import chaos_profile_snapshot as _snapshot

    snap = _snapshot()
    return {
        "openai": snap.get("openai") or chaos_mode("openai"),
        "tavily": snap.get("tavily") or chaos_mode("tavily"),
        "linear_mcp": snap.get("linear_mcp") or chaos_mode("linear_mcp"),
    }
