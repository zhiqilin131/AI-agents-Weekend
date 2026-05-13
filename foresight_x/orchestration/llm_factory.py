"""LLM factory helpers for pipeline structured prediction."""

from __future__ import annotations

import re
from typing import Any

from llama_index.llms.openai import OpenAI, OpenAIResponses

from foresight_x.config import Settings, load_settings
from foresight_x.orchestration.llm_gateway import LLMGateway, LLMProviderClient


class _OpenAIResponsesReasoningCompat(OpenAIResponses):
    """Strip sampling params OpenAI rejects on Responses + reasoning models (e.g. gpt-5.x)."""

    def _get_model_kwargs(self, **kwargs: Any) -> dict[str, Any]:
        payload = super()._get_model_kwargs(**kwargs)
        # API: ``Unsupported parameter: 'temperature' is not supported with this model.``
        payload.pop("temperature", None)
        payload.pop("top_p", None)
        return payload

# OpenAI documents GPT-5.x reasoning models for ``/v1/responses`` (Responses API).
# Chat Completions may fail or behave poorly for these ids; LlamaIndex ``OpenAI`` uses chat.completions.
_GPT5_RESPONSES = re.compile(r"^gpt-5(?:[.\-]|$)", re.IGNORECASE)
_REASONING_PREFIXES = ("o1", "o3", "o4")


def provider_model_uses_openai_responses_api(model: str) -> bool:
    """Return True when the provider model should use OpenAI's Responses API (not chat.completions)."""
    m = (model or "").strip()
    if not m:
        return False
    if _GPT5_RESPONSES.match(m):
        return True
    low = m.lower()
    return any(low.startswith(p) for p in _REASONING_PREFIXES)


def _build_openai_client(
    settings: Settings | None = None,
    *,
    temperature: float | None = None,
    model: str | None = None,
    **extra: Any,
) -> Any:
    """Build a LlamaIndex OpenAI-compatible LLM for structured_predict calls.

    GPT-5 / reasoning models are routed to :class:`OpenAIResponses` (``client.responses.create``),
    per OpenAI's deployment guidance. Other models use chat completions (:class:`OpenAI`).

    Pass ``model`` to override the resolved Slime tier / legacy ``OPENAI_MODEL`` for this call only.
    """
    s = settings or load_settings()
    resolved = ((model or "").strip() or s.openai_model).strip()
    temp = 0.2 if temperature is None else float(temperature)
    extra_kw: dict[str, Any] = dict(extra)
    max_tokens_extra = extra_kw.pop("max_tokens", None)
    forced_api_key = (str(extra_kw.pop("api_key", "") or "") or None)
    forced_api_base = (str(extra_kw.pop("api_base", "") or "") or None)
    extra_kw.setdefault("timeout", float(s.openai_request_timeout_sec))

    if provider_model_uses_openai_responses_api(resolved):
        max_out = s.openai_responses_max_output_tokens
        if max_tokens_extra is not None:
            max_out = int(max_tokens_extra)
        effort = (s.openai_responses_reasoning_effort or "low").strip().lower()
        reasoning_payload: dict[str, Any] = {"effort": effort} if effort else {}
        # LlamaIndex only forwards ``reasoning`` for O1_MODELS; GPT-5 needs it via additional_kwargs.
        add_kw: dict[str, Any] = dict(extra_kw.pop("additional_kwargs", None) or {})
        add_kw.setdefault("reasoning", reasoning_payload)
        return _OpenAIResponsesReasoningCompat(
            model=resolved,
            api_key=forced_api_key or ((s.openai_api_key or "").strip() or None),
            api_base=forced_api_base or s.openai_api_base,
            temperature=temp,
            max_output_tokens=max_out,
            reasoning_options=reasoning_payload or None,
            additional_kwargs=add_kw,
            context_window=int(s.openai_responses_context_window or 1_048_576),
            **extra_kw,
        )

    kwargs: dict[str, Any] = {
        "model": resolved,
        "api_key": forced_api_key or (s.openai_api_key or None),
        "temperature": temp,
    }
    if max_tokens_extra is not None:
        kwargs["max_tokens"] = max_tokens_extra
    if forced_api_base:
        kwargs["api_base"] = forced_api_base
    elif s.openai_api_base:
        kwargs["api_base"] = s.openai_api_base
    kwargs.setdefault("timeout", float(s.openai_request_timeout_sec))
    kwargs.update(extra_kw)
    return OpenAI(**kwargs)


def _parse_provider_model(spec: str) -> tuple[str, str]:
    s = (spec or "").strip()
    if ":" not in s:
        return "", s
    p, m = s.split(":", 1)
    return p.strip().lower(), m.strip()


def _build_provider_client(
    provider: str,
    model: str,
    settings: Settings,
    *,
    temperature: float | None = None,
    **extra: Any,
) -> Any:
    p = (provider or "openai").strip().lower()
    if p == "openai":
        return _build_openai_client(settings, temperature=temperature, model=model, **extra)
    if p == "anthropic":
        try:
            from llama_index.llms.anthropic import Anthropic
        except Exception as exc:  # pragma: no cover - optional dependency path
            raise RuntimeError("anthropic provider requires llama-index-llms-anthropic") from exc
        key = (settings.resilience_secondary_openai_api_key or "").strip() or None
        return Anthropic(model=model, api_key=key, temperature=0.2 if temperature is None else float(temperature))
    raise RuntimeError(f"unsupported provider in FX_LLM_*: {provider}")


def build_secondary_openai_llm(
    settings: Settings | None = None,
    *,
    temperature: float | None = None,
    **extra: Any,
) -> Any | None:
    """Build optional secondary OpenAI-compatible failover LLM from resilience settings."""
    s = settings or load_settings()
    model = (s.resilience_secondary_openai_model or "").strip()
    if not model:
        return None
    key = (s.resilience_secondary_openai_api_key or "").strip() or (s.openai_api_key or "").strip()
    if not key:
        return None
    extra_kw: dict[str, Any] = dict(extra)
    extra_kw["api_key"] = key
    api_base = (s.resilience_secondary_openai_api_base or "").strip()
    if api_base:
        extra_kw["api_base"] = api_base
    return _build_openai_client(s, temperature=temperature, model=model, **extra_kw)


def build_openai_llm(
    settings: Settings | None = None,
    *,
    temperature: float | None = None,
    model: str | None = None,
    **extra: Any,
) -> Any:
    """Build unified LLM gateway (primary + optional fallback providers)."""
    s = settings or load_settings()

    p_provider = "openai"
    p_model = ((model or "").strip() or s.openai_model).strip()
    spec_provider, spec_model = _parse_provider_model(s.fx_llm_primary)
    if not model and spec_provider and spec_model:
        p_provider, p_model = spec_provider, spec_model
    primary = LLMProviderClient(
        provider=p_provider,
        model=p_model,
        client=_build_provider_client(p_provider, p_model, s, temperature=temperature, **extra),
    )

    providers: list[LLMProviderClient] = [primary]
    fb_spec = (s.fx_llm_fallback or "").strip()
    fb_provider, fb_model = _parse_provider_model(fb_spec)
    if fb_provider and fb_model:
        try:
            providers.append(
                LLMProviderClient(
                    provider=fb_provider,
                    model=fb_model,
                    client=_build_provider_client(fb_provider, fb_model, s, temperature=temperature, **extra),
                )
            )
        except Exception:
            pass

    if len(providers) == 1:
        secondary = build_secondary_openai_llm(s, temperature=temperature, **extra)
        if secondary is not None:
            providers.append(
                LLMProviderClient(
                    provider="openai_secondary",
                    model=(s.resilience_secondary_openai_model or "").strip() or s.openai_model,
                    client=secondary,
                )
            )

    order_raw = (s.fx_llm_failover_order or "").strip()
    if order_raw:
        order = [x.strip().lower() for x in order_raw.split(",") if x.strip()]
        if order:
            bucket = {p.provider.lower(): p for p in providers}
            reordered: list[LLMProviderClient] = []
            for key in order:
                p = bucket.pop(key, None)
                if p is not None:
                    reordered.append(p)
            reordered.extend(bucket.values())
            if reordered:
                providers = reordered

    return LLMGateway(
        providers,
        request_timeout_s=float(s.fx_llm_request_timeout_s or s.openai_request_timeout_sec),
        max_retries=int(s.fx_llm_max_retries or s.resilience_retry_attempts),
    )
