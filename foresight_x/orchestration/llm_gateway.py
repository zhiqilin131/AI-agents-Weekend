"""Unified resilient LLM gateway with retry/backoff and provider failover."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel
from tenacity import (
    RetryCallState,
    Retrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

from foresight_x.resilience.runtime import degrade, record_provider_call


@dataclass(frozen=True)
class LLMProviderClient:
    provider: str
    model: str
    client: Any


class LLMCall(BaseModel):
    provider_used: str
    model_used: str
    attempt_count: int = 1
    fallback_reason: str = ""


@dataclass
class LLMGatewayResult:
    value: Any
    call: LLMCall


class LLMGateway:
    """Resilient wrapper over one or more provider clients."""

    def __init__(
        self,
        providers: list[LLMProviderClient],
        *,
        request_timeout_s: float = 20.0,
        max_retries: int = 3,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        if not providers:
            raise ValueError("LLMGateway requires at least one provider")
        self._providers = providers
        self._request_timeout_s = float(max(1.0, request_timeout_s))
        self._max_retries = int(max(1, max_retries))
        self._sleep_fn = sleep_fn
        self.last_call: LLMCall | None = None

    @property
    def primary_client(self) -> Any:
        return self._providers[0].client

    def __getattr__(self, item: str) -> Any:
        return getattr(self.primary_client, item)

    def _retry_after_seconds(self, exc: Exception) -> float:
        ra = getattr(exc, "retry_after", None)
        if isinstance(ra, (int, float)) and ra > 0:
            return float(min(ra, 30.0))
        resp = getattr(exc, "response", None)
        headers = getattr(resp, "headers", None)
        if isinstance(headers, dict):
            v = headers.get("Retry-After")
            try:
                fv = float(v)
                if fv > 0:
                    return min(fv, 30.0)
            except Exception:
                pass
        msg = str(exc).lower()
        if "retry-after" in msg:
            return 5.0
        return 0.0

    def _is_retryable(self, exc: Exception) -> bool:
        name = type(exc).__name__.lower()
        msg = str(exc).lower()
        if self._retry_after_seconds(exc) > 0:
            return True
        if "ratelimit" in name or "429" in msg or "rate limit" in msg:
            return True
        if "timeout" in name or "timeout" in msg:
            return True
        if "connection" in name or "temporar" in msg:
            return True
        if (
            "internalservererror" in name
            or "internal server error" in msg
            or "5xx" in msg
            or "500" in msg
            or "503" in msg
            or "502" in msg
        ):
            return True
        return False

    def _fallback_reason(self, exc: Exception) -> str:
        msg = str(exc).lower()
        name = type(exc).__name__.lower()
        if "429" in msg or "ratelimit" in name or self._retry_after_seconds(exc) > 0:
            return "primary_429"
        if "5xx" in msg or "500" in msg or "502" in msg or "503" in msg or "internalservererror" in name:
            return "primary_5xx"
        if "timeout" in msg or "timeout" in name:
            return "primary_timeout"
        return "primary_error"

    def _with_retry(self, provider: LLMProviderClient, method: str, *args: Any, **kwargs: Any) -> tuple[Any, int]:
        attempts = 0

        def _before_sleep(rs: RetryCallState) -> None:
            exc = rs.outcome.exception() if rs.outcome else None
            if isinstance(exc, Exception):
                ra = self._retry_after_seconds(exc)
                if ra > 0:
                    self._sleep_fn(ra + random.uniform(0.0, 0.35))

        retryer = Retrying(
            stop=stop_after_attempt(self._max_retries),
            wait=wait_exponential_jitter(initial=0.25, max=3.0),
            retry=retry_if_exception(lambda e: isinstance(e, Exception) and self._is_retryable(e)),
            reraise=True,
            sleep=self._sleep_fn,
            before_sleep=_before_sleep,
        )
        for attempt in retryer:
            attempts = attempt.retry_state.attempt_number
            with attempt:
                return getattr(provider.client, method)(*args, **kwargs), attempts
        raise RuntimeError("unreachable_retry_loop")

    def invoke(self, method: str, *args: Any, **kwargs: Any) -> LLMGatewayResult:
        primary_error: Exception | None = None
        first_reason = ""
        for idx, p in enumerate(self._providers):
            t0 = time.perf_counter()
            try:
                value, attempts = self._with_retry(p, method, *args, **kwargs)
                latency_ms = (time.perf_counter() - t0) * 1000.0
                record_provider_call(
                    p.provider,
                    ok=True,
                    latency_ms=latency_ms,
                    brownout_threshold_ms=9_000.0,
                )
                call = LLMCall(
                    provider_used=p.provider,
                    model_used=p.model,
                    attempt_count=attempts,
                    fallback_reason=(first_reason if idx > 0 else ""),
                )
                self.last_call = call
                return LLMGatewayResult(value=value, call=call)
            except Exception as exc:
                latency_ms = (time.perf_counter() - t0) * 1000.0
                record_provider_call(
                    p.provider,
                    ok=False,
                    latency_ms=latency_ms,
                    brownout_threshold_ms=9_000.0,
                    error_kind=type(exc).__name__,
                )
                if idx == 0:
                    primary_error = exc
                    first_reason = self._fallback_reason(exc)
                if idx + 1 < len(self._providers):
                    degrade(
                        component=f"llm:{p.provider}",
                        reason=f"provider failed; failing over ({first_reason or 'provider_error'})",
                        stage="llm_gateway",
                        retryable=True,
                        error_kind=type(exc).__name__,
                    )
                    continue
                raise
        if primary_error is not None:
            raise primary_error
        raise RuntimeError("llm_gateway_invoke_failed")

    def complete(self, *args: Any, **kwargs: Any) -> Any:
        return self.invoke("complete", *args, **kwargs).value

    def chat(self, *args: Any, **kwargs: Any) -> Any:
        return self.invoke("chat", *args, **kwargs).value

    def structured_predict(self, output_cls: Any, prompt: Any, **kwargs: Any) -> Any:
        res = self.invoke("structured_predict", output_cls, prompt, **kwargs)
        out = res.value
        if isinstance(output_cls, type) and issubclass(output_cls, BaseModel):
            if isinstance(out, output_cls):
                return out
            try:
                return output_cls.model_validate(out)
            except Exception:
                strict_prompt = (
                    "Return ONLY JSON matching the schema exactly. "
                    "Do not include markdown or extra explanation.\n\n"
                    f"{prompt}"
                )
                strict_res = self.invoke("structured_predict", output_cls, strict_prompt, **kwargs)
                out2 = strict_res.value
                if isinstance(out2, output_cls):
                    return out2
                return output_cls.model_validate(out2)
        return out
