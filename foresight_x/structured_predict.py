"""Compatibility wrapper for LlamaIndex structured prediction."""

from __future__ import annotations

import time
from typing import Any

from llama_index.core import PromptTemplate

from foresight_x.config import load_settings
from foresight_x.resilience.runtime import (
    chaos_mode,
    circuit_allow,
    circuit_record,
    degrade,
    record_provider_call,
)


class _InjectedProviderFault(RuntimeError):
    pass


def _is_llamaindex_like_llm(llm: Any) -> bool:
    mod = str(getattr(getattr(llm, "__class__", object), "__module__", "") or "")
    return mod.startswith("llama_index")


def _call_structured(llm: Any, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
    try:
        return llm.structured_predict(output_cls, prompt, **kwargs)
    except Exception:
        return llm.structured_predict(output_cls, PromptTemplate(prompt), **kwargs)


def _is_retryable_error(exc: Exception) -> bool:
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    if "timeout" in name or "timeout" in msg:
        return True
    if "ratelimit" in name or "rate limit" in msg or "429" in msg:
        return True
    if "connection" in name or "temporar" in msg:
        return True
    if "apierror" in name or "5xx" in msg or "503" in msg or "502" in msg:
        return True
    return False


def structured_predict(llm: Any, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
    """Run structured prediction across llama-index API variants.

    Older call sites and test doubles use raw string prompts; newer llama-index
    releases require a BasePromptTemplate instance.
    """
    if not _is_llamaindex_like_llm(llm):
        return _call_structured(llm, output_cls, prompt, **kwargs)

    s = load_settings()
    provider = "openai"
    if not circuit_allow(
        provider,
        failure_threshold=s.resilience_circuit_failure_threshold,
        open_seconds=s.resilience_circuit_open_sec,
    ):
        degrade(
            component=provider,
            reason="circuit breaker open; skipping provider call",
            stage="structured_predict",
            retryable=True,
            error_kind="circuit_open",
        )
        raise RuntimeError("provider_unavailable_circuit_open")
    mode = chaos_mode("openai")
    if mode in ("5xx", "429", "timeout"):
        degrade(
            component=provider,
            reason=f"chaos injection active ({mode})",
            stage="structured_predict",
            retryable=True,
            error_kind=mode,
        )
        if mode == "timeout":
            raise _InjectedProviderFault("chaos_timeout")
        if mode == "429":
            raise _InjectedProviderFault("chaos_rate_limit_429")
        raise _InjectedProviderFault("chaos_provider_5xx")

    attempts = max(1, int(s.resilience_retry_attempts))
    backoff_ms = max(0, int(s.resilience_retry_backoff_ms))
    last_exc: Exception | None = None
    for i in range(attempts):
        t0 = time.perf_counter()
        try:
            out = _call_structured(llm, output_cls, prompt, **kwargs)
            latency_ms = (time.perf_counter() - t0) * 1000.0
            circuit_record(provider, ok=True)
            record_provider_call(
                provider,
                ok=True,
                latency_ms=latency_ms,
                brownout_threshold_ms=float(s.resilience_brownout_latency_ms),
            )
            return out
        except Exception as exc:
            last_exc = exc
            latency_ms = (time.perf_counter() - t0) * 1000.0
            circuit_record(provider, ok=False)
            record_provider_call(
                provider,
                ok=False,
                latency_ms=latency_ms,
                brownout_threshold_ms=float(s.resilience_brownout_latency_ms),
                error_kind=type(exc).__name__,
            )
            retryable = _is_retryable_error(exc)
            if i + 1 < attempts and retryable:
                degrade(
                    component=provider,
                    reason=f"transient error; retry {i + 1}/{attempts - 1}",
                    stage="structured_predict",
                    retryable=True,
                    error_kind=type(exc).__name__,
                )
                if backoff_ms > 0:
                    time.sleep((backoff_ms * (2**i)) / 1000.0)
                continue
            degrade(
                component=provider,
                reason="provider call failed; escalating to caller fallback",
                stage="structured_predict",
                retryable=retryable,
                error_kind=type(exc).__name__,
            )
            if retryable:
                from foresight_x.orchestration.llm_factory import build_secondary_openai_llm

                secondary = build_secondary_openai_llm(s, temperature=0.2)
                if secondary is not None:
                    degrade(
                        component="openai_secondary",
                        reason="attempting secondary provider/model failover",
                        stage="structured_predict",
                        retryable=True,
                        error_kind="failover",
                    )
                    t1 = time.perf_counter()
                    try:
                        out = _call_structured(secondary, output_cls, prompt, **kwargs)
                        latency_ms = (time.perf_counter() - t1) * 1000.0
                        record_provider_call(
                            "openai_secondary",
                            ok=True,
                            latency_ms=latency_ms,
                            brownout_threshold_ms=float(s.resilience_brownout_latency_ms),
                        )
                        return out
                    except Exception as sec_exc:
                        latency_ms = (time.perf_counter() - t1) * 1000.0
                        record_provider_call(
                            "openai_secondary",
                            ok=False,
                            latency_ms=latency_ms,
                            brownout_threshold_ms=float(s.resilience_brownout_latency_ms),
                            error_kind=type(sec_exc).__name__,
                        )
                        degrade(
                            component="openai_secondary",
                            reason="secondary failover call failed",
                            stage="structured_predict",
                            retryable=False,
                            error_kind=type(sec_exc).__name__,
                        )
            raise
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("structured_predict_failed_without_exception")
