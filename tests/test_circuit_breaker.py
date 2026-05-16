"""FOR-19: circuit breaker states, trip, half-open probe, brown-out."""

from __future__ import annotations

import time

import pytest

from foresight_x.orchestration.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    breaker_before_call,
    get_breaker,
    reset_all_breakers,
)
from foresight_x.resilience.errors import DependencyDegraded


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_all_breakers()


def test_five_failures_trip_and_short_circuit() -> None:
    cfg = CircuitBreakerConfig(failure_threshold=5, cool_down_s=60.0, window_s=30.0)
    b = CircuitBreaker(name="llm.primary", config=cfg)
    for _ in range(5):
        b.record_failure(latency_ms=10.0, error_kind="500")
    assert b.snapshot()["state"] == "open"
    t0 = time.perf_counter()
    with pytest.raises(DependencyDegraded):
        b.before_call()
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    assert elapsed_ms < 5.0


def test_half_open_after_cooldown_allows_single_probe() -> None:
    cfg = CircuitBreakerConfig(failure_threshold=2, cool_down_s=0.05, window_s=30.0)
    b = CircuitBreaker(name="tavily", config=cfg)
    b.record_failure(error_kind="timeout")
    b.record_failure(error_kind="timeout")
    assert b.snapshot()["state"] == "open"
    time.sleep(0.06)
    b.before_call()
    assert b.snapshot()["state"] == "half_open"
    b.record_success(latency_ms=1.0)
    assert b.snapshot()["state"] == "closed"


def test_brownout_degraded_without_open() -> None:
    cfg = CircuitBreakerConfig(
        failure_threshold=10,
        cool_down_s=30.0,
        window_s=30.0,
        brownout_p95_ms=100.0,
    )
    b = CircuitBreaker(name="llm.fallback", config=cfg)
    for _ in range(5):
        b.record_success(latency_ms=200.0)
    snap = b.snapshot()
    assert snap["state"] == "closed"
    assert snap["degraded"] is True


def test_registry_keys() -> None:
    b1 = get_breaker("llm.primary")
    b2 = get_breaker("openai")
    assert b1.name == b2.name == "llm.primary"


def test_breaker_before_call_raises_when_open() -> None:
    cfg = CircuitBreakerConfig(failure_threshold=1, cool_down_s=60.0)
    b = get_breaker("mcp.linear", config=cfg)
    b.record_failure(error_kind="outage")
    with pytest.raises(DependencyDegraded):
        breaker_before_call("mcp.linear")
