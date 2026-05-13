from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from foresight_x.orchestration.llm_gateway import LLMGateway, LLMProviderClient


class _Always500:
    def __init__(self) -> None:
        self.calls = 0

    def structured_predict(self, _output_cls: Any, _prompt: Any, **_kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        raise RuntimeError("500 internal server error")


class _FallbackOK:
    def __init__(self) -> None:
        self.calls = 0

    def structured_predict(self, _output_cls: Any, _prompt: Any, **_kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        return {"answer": "fallback-ok"}


@dataclass
class _RateLimit429(Exception):
    retry_after: float = 5.0

    def __str__(self) -> str:
        return "429 rate limit"


class _RateLimitThenOK:
    def __init__(self) -> None:
        self.calls = 0

    def structured_predict(self, _output_cls: Any, _prompt: Any, **_kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        if self.calls == 1:
            raise _RateLimit429(retry_after=5.0)
        return {"answer": "primary-after-backoff"}


class _PrimaryHealthy:
    def __init__(self) -> None:
        self.calls = 0

    def structured_predict(self, _output_cls: Any, _prompt: Any, **_kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        return {"answer": "primary-ok"}


def test_gateway_fails_over_after_primary_5xx_burst() -> None:
    primary = _Always500()
    fallback = _FallbackOK()
    gw = LLMGateway(
        [
            LLMProviderClient("openai", "gpt-4o-mini", primary),
            LLMProviderClient("anthropic", "claude-3-5-sonnet", fallback),
        ],
        max_retries=3,
        request_timeout_s=20.0,
        sleep_fn=lambda _s: None,
    )
    out = gw.structured_predict(dict, "hello")
    assert out == {"answer": "fallback-ok"}
    assert primary.calls == 3
    assert fallback.calls == 1
    assert gw.last_call is not None
    assert gw.last_call.provider_used == "anthropic"
    assert gw.last_call.fallback_reason == "primary_5xx"


def test_gateway_handles_429_retry_after_then_succeeds() -> None:
    sleeps: list[float] = []
    primary = _RateLimitThenOK()
    gw = LLMGateway(
        [LLMProviderClient("openai", "gpt-4o-mini", primary)],
        max_retries=3,
        request_timeout_s=20.0,
        sleep_fn=lambda s: sleeps.append(float(s)),
    )
    out = gw.structured_predict(dict, "hello")
    assert out == {"answer": "primary-after-backoff"}
    assert primary.calls == 2
    assert any(s >= 5.0 for s in sleeps)


def test_gateway_keeps_healthy_behavior_without_failover() -> None:
    primary = _PrimaryHealthy()
    fallback = _FallbackOK()
    gw = LLMGateway(
        [
            LLMProviderClient("openai", "gpt-4o-mini", primary),
            LLMProviderClient("anthropic", "claude-3-5-sonnet", fallback),
        ],
        max_retries=3,
        request_timeout_s=20.0,
        sleep_fn=lambda _s: None,
    )
    out = gw.structured_predict(dict, "hello")
    assert out == {"answer": "primary-ok"}
    assert primary.calls == 1
    assert fallback.calls == 0
    assert gw.last_call is not None
    assert gw.last_call.provider_used == "openai"
    assert gw.last_call.fallback_reason == ""
