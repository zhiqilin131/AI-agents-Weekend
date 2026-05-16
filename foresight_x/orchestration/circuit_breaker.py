"""Per-dependency circuit breakers with sliding-window brown-out detection."""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from foresight_x.resilience.errors import DependencyDegraded

# Canonical breaker keys (FOR-19)
BREAKER_LLM_PRIMARY = "llm.primary"
BREAKER_LLM_FALLBACK = "llm.fallback"
BREAKER_TAVILY = "tavily"
BREAKER_MCP_LINEAR = "mcp.linear"

_DEFAULT_KEYS = (
    BREAKER_LLM_PRIMARY,
    BREAKER_LLM_FALLBACK,
    BREAKER_TAVILY,
    BREAKER_MCP_LINEAR,
)

_ALIASES: dict[str, str] = {
    "openai": BREAKER_LLM_PRIMARY,
    "llm_primary": BREAKER_LLM_PRIMARY,
    "llmprimary": BREAKER_LLM_PRIMARY,
    "llm_fallback": BREAKER_LLM_FALLBACK,
    "llmfallback": BREAKER_LLM_FALLBACK,
    "tavily": BREAKER_TAVILY,
    "linear_mcp": BREAKER_MCP_LINEAR,
    "linear": BREAKER_MCP_LINEAR,
    "mcp_linear": BREAKER_MCP_LINEAR,
    "mcp.linear": BREAKER_MCP_LINEAR,
}


@dataclass
class CircuitBreakerConfig:
    failure_threshold: int = 5
    cool_down_s: float = 30.0
    window_s: float = 30.0
    brownout_p95_ms: float = 8000.0
    rate_limit_trip_count: int = 3


@dataclass
class _CallSample:
    at: float
    ok: bool
    latency_ms: float
    error_kind: str = ""


@dataclass
class CircuitBreaker:
    """closed → open → half_open (single probe) → closed."""

    name: str
    config: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)
    state: str = "closed"
    consecutive_failures: int = 0
    open_until: float = 0.0
    half_open_probe_used: bool = False
    _samples: deque[_CallSample] = field(default_factory=deque)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def _prune(self, now: float) -> None:
        cutoff = now - float(self.config.window_s)
        while self._samples and self._samples[0].at < cutoff:
            self._samples.popleft()

    def _p95_latency_ms(self) -> float:
        latencies = sorted(s.latency_ms for s in self._samples if s.latency_ms > 0)
        if not latencies:
            return 0.0
        idx = max(0, int(round(0.95 * (len(latencies) - 1))))
        return float(latencies[idx])

    def _rate_limit_hits(self) -> int:
        return sum(
            1
            for s in self._samples
            if not s.ok
            and (
                "429" in (s.error_kind or "").lower()
                or "ratelimit" in (s.error_kind or "").lower()
                or s.error_kind.lower() == "primary_429"
            )
        )

    def _brownout_degraded_unlocked(self) -> bool:
        """Caller must hold ``_lock``."""
        if len(self._samples) < 3:
            return False
        p95 = self._p95_latency_ms()
        if p95 >= float(self.config.brownout_p95_ms):
            return True
        if self._rate_limit_hits() >= int(self.config.rate_limit_trip_count):
            return True
        return False

    def brownout_degraded(self) -> bool:
        """True when latency/rate-limit stress is high but breaker may still be closed."""
        with self._lock:
            now = time.time()
            self._prune(now)
            return self._brownout_degraded_unlocked()

    def _transition_after_cooldown(self, now: float) -> None:
        if self.state == "open" and now >= self.open_until:
            self.state = "half_open"
            self.half_open_probe_used = False

    def before_call(self) -> None:
        """Raise :class:`DependencyDegraded` when the circuit is open (not probing)."""
        with self._lock:
            now = time.time()
            self._transition_after_cooldown(now)
            if self.state == "closed":
                return
            if self.state == "half_open":
                if not self.half_open_probe_used:
                    self.half_open_probe_used = True
                    return
                raise DependencyDegraded(
                    self.name,
                    status=503,
                    reason="circuit_half_open_probe_in_flight",
                    retryable=True,
                )
            raise DependencyDegraded(
                self.name,
                status=503,
                reason="circuit_breaker_open",
                retryable=True,
            )

    def record_success(self, *, latency_ms: float = 0.0) -> None:
        with self._lock:
            now = time.time()
            self._samples.append(_CallSample(at=now, ok=True, latency_ms=max(0.0, latency_ms)))
            self._prune(now)
            self.consecutive_failures = 0
            if self.state in ("half_open", "open"):
                self.state = "closed"
                self.open_until = 0.0
                self.half_open_probe_used = False

    def record_failure(self, *, latency_ms: float = 0.0, error_kind: str = "") -> None:
        with self._lock:
            now = time.time()
            self._samples.append(
                _CallSample(
                    at=now,
                    ok=False,
                    latency_ms=max(0.0, latency_ms),
                    error_kind=(error_kind or "").strip(),
                )
            )
            self._prune(now)
            self.consecutive_failures += 1
            if self.state == "half_open":
                self.state = "open"
                self.open_until = now + float(self.config.cool_down_s)
                self.half_open_probe_used = False
                return
            if self.consecutive_failures >= int(self.config.failure_threshold):
                self.state = "open"
                self.open_until = now + float(self.config.cool_down_s)

    def allow_call(self) -> bool:
        """True when a call is permitted (does not consume a half-open probe)."""
        with self._lock:
            now = time.time()
            self._transition_after_cooldown(now)
            if self.state == "closed":
                return True
            if self.state == "half_open" and not self.half_open_probe_used:
                return True
            return False

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            now = time.time()
            self._prune(now)
            self._transition_after_cooldown(now)
            return {
                "name": self.name,
                "state": self.state,
                "consecutive_failures": self.consecutive_failures,
                "open_until_epoch": self.open_until,
                "degraded": self._brownout_degraded_unlocked(),
                "window_samples": len(self._samples),
                "p95_latency_ms": round(self._p95_latency_ms(), 1),
                "rate_limit_hits": self._rate_limit_hits(),
            }


_REGISTRY_LOCK = threading.Lock()
_BREAKERS: dict[str, CircuitBreaker] = {}


def normalize_breaker_key(name: str) -> str:
    raw = (name or "").strip().lower().replace("_", ".")
    if raw in _ALIASES:
        return _ALIASES[raw]
    if raw in _DEFAULT_KEYS:
        return raw
    if raw.startswith("mcp."):
        return raw
    return (name or "unknown").strip()


def _config_from_settings() -> CircuitBreakerConfig:
    try:
        from foresight_x.config import load_settings

        s = load_settings()
        return CircuitBreakerConfig(
            failure_threshold=int(s.resilience_circuit_failure_threshold),
            cool_down_s=float(s.resilience_circuit_open_sec),
            window_s=30.0,
            brownout_p95_ms=float(s.resilience_brownout_latency_ms),
            rate_limit_trip_count=3,
        )
    except Exception:
        return CircuitBreakerConfig()


def get_breaker(name: str, *, config: CircuitBreakerConfig | None = None) -> CircuitBreaker:
    key = normalize_breaker_key(name)
    with _REGISTRY_LOCK:
        b = _BREAKERS.get(key)
        if b is None:
            cfg = config or CircuitBreakerConfig()
            b = CircuitBreaker(name=key, config=cfg)
            _BREAKERS[key] = b
        elif config is not None:
            b.config = config
        return b


def reset_all_breakers() -> None:
    with _REGISTRY_LOCK:
        _BREAKERS.clear()


def breaker_before_call(name: str) -> None:
    get_breaker(name).before_call()


def breaker_record_success(name: str, *, latency_ms: float = 0.0) -> None:
    get_breaker(name).record_success(latency_ms=latency_ms)


def breaker_record_failure(name: str, *, latency_ms: float = 0.0, error_kind: str = "") -> None:
    get_breaker(name).record_failure(latency_ms=latency_ms, error_kind=error_kind)


def circuit_allow(name: str, *, failure_threshold: int | None = None, open_seconds: float | None = None) -> bool:
    cfg = CircuitBreakerConfig()
    if failure_threshold is not None or open_seconds is not None:
        cfg = _config_from_settings()
        if failure_threshold is not None:
            cfg.failure_threshold = int(failure_threshold)
        if open_seconds is not None:
            cfg.cool_down_s = float(open_seconds)
    return get_breaker(name, config=cfg).allow_call()


def circuit_record(name: str, *, ok: bool, latency_ms: float = 0.0, error_kind: str = "") -> None:
    b = get_breaker(name)
    if ok:
        b.record_success(latency_ms=latency_ms)
    else:
        b.record_failure(latency_ms=latency_ms, error_kind=error_kind)


def get_resilience_snapshot() -> dict[str, Any]:
    """Snapshot for report card and trace runtime metadata."""
    with _REGISTRY_LOCK:
        names = list(_BREAKERS.keys())
    breakers = {n: get_breaker(n).snapshot() for n in sorted(names)}
    return {
        "breakers": breakers,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def breaker_states_snapshot() -> dict[str, Any]:
    snap = get_resilience_snapshot().get("breakers") or {}
    out: dict[str, Any] = {}
    for name, row in snap.items():
        if not isinstance(row, dict):
            continue
        out[name] = {
            "state": row.get("state", "closed"),
            "failures": row.get("consecutive_failures", 0),
            "open_until_epoch": row.get("open_until_epoch", 0.0),
            "degraded": bool(row.get("degraded")),
            "p95_latency_ms": row.get("p95_latency_ms", 0.0),
        }
    return out
