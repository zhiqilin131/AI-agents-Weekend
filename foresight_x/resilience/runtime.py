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


def start_resilience_run() -> object:
    """Begin a run-scoped resilience event list."""
    return _run_events_var.set([])


def end_resilience_run(token: object) -> list[dict[str, Any]]:
    """Finish run-scoped collection and restore prior context."""
    events = list(_run_events_var.get() or [])
    _run_events_var.reset(token)  # type: ignore[arg-type]
    return events


def current_run_events() -> list[dict[str, Any]]:
    return list(_run_events_var.get() or [])


def _append_run_event(ev: dict[str, Any]) -> None:
    cur = _run_events_var.get()
    if cur is None:
        return
    cur.append(ev)


_LOCK = threading.Lock()
_PROVIDER_STATS: dict[str, dict[str, float]] = {}
_BREAKERS: dict[str, dict[str, float]] = {}


def reset_resilience_runtime_state() -> None:
    """Testing helper: clear global counters and breaker state."""
    with _LOCK:
        _PROVIDER_STATS.clear()
        _BREAKERS.clear()


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
    now = time.time()
    with _LOCK:
        b = _BREAKERS.get(provider)
        if b is None:
            b = {
                "failures": 0.0,
                "open_until": 0.0,
                "failure_threshold": float(max(1, failure_threshold)),
                "open_seconds": float(max(1.0, open_seconds)),
            }
            _BREAKERS[provider] = b
        else:
            b["failure_threshold"] = float(max(1, failure_threshold))
            b["open_seconds"] = float(max(1.0, open_seconds))
        return now >= float(b.get("open_until", 0.0))


def circuit_record(provider: str, *, ok: bool) -> None:
    now = time.time()
    with _LOCK:
        b = _BREAKERS.setdefault(
            provider,
            {
                "failures": 0.0,
                "open_until": 0.0,
                "failure_threshold": 3.0,
                "open_seconds": 30.0,
            },
        )
        if ok:
            b["failures"] = 0.0
            return
        b["failures"] = float(b.get("failures", 0.0)) + 1.0
        if b["failures"] >= float(b.get("failure_threshold", 3.0)):
            b["open_until"] = now + float(b.get("open_seconds", 30.0))


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
    if (not ok) and error_kind:
        degrade(
            component=provider,
            reason=f"{provider} error: {error_kind}",
            stage="runtime",
            retryable=True,
            error_kind=error_kind,
        )


def degrade(
    *,
    component: str,
    reason: str,
    stage: str = "",
    retryable: bool = True,
    error_kind: str = "",
) -> dict[str, Any]:
    ev = {
        "at": _utc_now(),
        "component": (component or "runtime").strip()[:80],
        "stage": (stage or "").strip()[:64],
        "reason": (reason or "degraded").strip()[:240],
        "retryable": bool(retryable),
        "error_kind": (error_kind or "").strip()[:80],
    }
    _append_run_event(ev)
    return ev


def chaos_mode(provider: str) -> str:
    p = (provider or "").strip().upper()
    if not p:
        return ""
    return os.getenv(f"CHAOS_{p}_MODE", "").strip().lower()


def probe_linear_mcp() -> None:
    """Record Linear MCP availability signal for this run (non-blocking)."""
    mode = chaos_mode("linear_mcp")
    if mode in ("outage", "timeout", "5xx"):
        record_provider_call(
            "linear_mcp",
            ok=False,
            latency_ms=0.0,
            brownout_threshold_ms=10_000.0,
            error_kind=mode,
        )
        degrade(
            component="linear_mcp",
            reason="Linear MCP unavailable; continuing without MCP assist",
            stage="infra_probe",
            retryable=True,
            error_kind=mode,
        )
        return
    record_provider_call(
        "linear_mcp",
        ok=True,
        latency_ms=1.0,
        brownout_threshold_ms=10_000.0,
    )


def resilience_health_report() -> dict[str, Any]:
    with _LOCK:
        stats = {k: dict(v) for k, v in _PROVIDER_STATS.items()}
        breakers = {k: dict(v) for k, v in _BREAKERS.items()}
    now = time.time()
    breaker_view: dict[str, Any] = {}
    for p, b in breakers.items():
        open_until = float(b.get("open_until", 0.0))
        breaker_view[p] = {
            "state": "open" if now < open_until else "closed",
            "failures": int(b.get("failures", 0.0)),
            "open_until_epoch": open_until,
        }
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
    with _LOCK:
        breakers = {k: dict(v) for k, v in _BREAKERS.items()}
    now = time.time()
    out: dict[str, Any] = {}
    for provider, row in breakers.items():
        open_until = float(row.get("open_until", 0.0))
        out[provider] = {
            "state": "open" if now < open_until else "closed",
            "failures": int(row.get("failures", 0.0)),
            "open_until_epoch": open_until,
        }
    return out


def chaos_profile_snapshot() -> dict[str, str]:
    """Snapshot active chaos profile for provider/runtime diagnostics."""
    return {
        "openai": chaos_mode("openai"),
        "tavily": chaos_mode("tavily"),
        "linear_mcp": chaos_mode("linear_mcp"),
    }
