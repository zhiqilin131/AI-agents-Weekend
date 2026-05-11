"""Routing for OpenAI Chat Completions vs Responses API (GPT-5 family)."""

from __future__ import annotations

import pytest
from llama_index.llms.openai import OpenAI, OpenAIResponses

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import (
    build_openai_llm,
    provider_model_uses_openai_responses_api,
)


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("gpt-5.4-mini", True),
        ("gpt-5.5", True),
        ("gpt-5.4", True),
        ("gpt-5", True),
        ("o3-mini", True),
        ("gpt-4o-mini", False),
        ("gpt-4o", False),
    ],
)
def test_provider_model_uses_openai_responses_api(model: str, expected: bool) -> None:
    assert provider_model_uses_openai_responses_api(model) is expected


def test_build_openai_llm_routes_gpt5_to_responses(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings()
    llm = build_openai_llm(s, model="gpt-5.4-mini", temperature=0.3)
    assert isinstance(llm, OpenAIResponses)  # compat subclass
    assert llm.model == "gpt-5.4-mini"
    assert llm.temperature == pytest.approx(0.3)
    assert llm.additional_kwargs.get("reasoning") == {"effort": "low"}


def test_build_openai_llm_keeps_gpt4_on_chat_completions(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings()
    llm = build_openai_llm(s, model="gpt-4o-mini")
    assert isinstance(llm, OpenAI)
    assert llm.model == "gpt-4o-mini"


def test_responses_payload_omits_temperature_top_p(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings()
    llm = build_openai_llm(s, model="gpt-5.4", temperature=0.68)
    mk = llm._get_model_kwargs()
    assert "temperature" not in mk
    assert "top_p" not in mk
    assert mk.get("reasoning") == {"effort": "low"}


def test_build_openai_llm_maps_max_tokens_for_responses(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings()
    llm = build_openai_llm(s, model="gpt-5.5", max_tokens=4096)
    assert isinstance(llm, OpenAIResponses)
    assert llm.max_output_tokens == 4096
