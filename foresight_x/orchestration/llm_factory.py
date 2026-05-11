"""LLM factory helpers for pipeline structured prediction."""

from __future__ import annotations

import re
from typing import Any

from llama_index.llms.openai import OpenAI, OpenAIResponses

from foresight_x.config import Settings, load_settings


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


def build_openai_llm(
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
            api_key=(s.openai_api_key or "").strip() or None,
            api_base=s.openai_api_base,
            temperature=temp,
            max_output_tokens=max_out,
            reasoning_options=reasoning_payload or None,
            additional_kwargs=add_kw,
            context_window=int(s.openai_responses_context_window or 1_048_576),
            **extra_kw,
        )

    kwargs: dict[str, Any] = {
        "model": resolved,
        "api_key": s.openai_api_key or None,
        "temperature": temp,
    }
    if max_tokens_extra is not None:
        kwargs["max_tokens"] = max_tokens_extra
    if s.openai_api_base:
        kwargs["api_base"] = s.openai_api_base
    kwargs.update(extra_kw)
    return OpenAI(**kwargs)
