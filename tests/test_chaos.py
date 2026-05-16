from __future__ import annotations

import random

import pytest
from fastapi.testclient import TestClient

from foresight_x.orchestration.chaos import (
    TARGET_LLM_PRIMARY,
    TARGET_TAVILY,
    ChaosProfile,
    DependencyDegraded,
    apply_env_leg,
    chaos_armed,
    chaos_mode,
    clear_runtime_profiles,
    get_profile,
    maybe_raise,
    parse_profile,
    profile_to_dict,
    reset_partial_json_slots,
)
from foresight_x.ui.api_server import app


@pytest.fixture(autouse=True)
def _clear_chaos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FX_CHAOS", raising=False)
    for key in (
        "FX_CHAOS_LLM_PRIMARY",
        "FX_CHAOS_TAVILY",
        "CHAOS_TAVILY_MODE",
        "CHAOS_OPENAI_MODE",
    ):
        monkeypatch.delenv(key, raising=False)
    clear_runtime_profiles()
    reset_partial_json_slots()


def test_chaos_disarmed_by_default() -> None:
    assert not chaos_armed()
    assert get_profile(TARGET_TAVILY) is None
    maybe_raise(TARGET_TAVILY)  # no-op


def test_parse_profile_shorthand() -> None:
    assert parse_profile("outage") == ChaosProfile(outage=True).normalized()
    assert parse_profile("5xx") is not None and parse_profile("5xx").status == 500
    assert parse_profile('{"error_rate": 0.5}') is not None
    assert parse_profile('{"error_rate": 0.5}').error_rate == 0.5


def test_chaos_armed_outage_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FX_CHAOS", "1")
    monkeypatch.setenv("FX_CHAOS_TAVILY", "outage")
    with pytest.raises(DependencyDegraded):
        maybe_raise(TARGET_TAVILY, rng=random.Random(0))


def test_legacy_chaos_openai_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FX_CHAOS", "1")
    monkeypatch.setenv("CHAOS_OPENAI_MODE", "429")
    assert chaos_mode("openai") == "429"


def test_apply_env_leg_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FX_CHAOS", "1")
    apply_env_leg({TARGET_LLM_PRIMARY: ChaosProfile(status=500, outage=True)})
    prof = get_profile(TARGET_LLM_PRIMARY)
    assert prof is not None
    assert prof.outage


def test_profile_to_dict_roundtrip() -> None:
    p = ChaosProfile(latency_ms=120, error_rate=0.25, partial_json=True)
    d = profile_to_dict(p)
    assert d["latency_ms"] == 120
    assert d["partial_json"] is True


def test_chaos_api_requires_armed(monkeypatch: pytest.MonkeyPatch) -> None:
    c = TestClient(app)
    assert c.get("/api/_chaos").status_code == 404


def test_llm_gateway_chaos_primary_fails_over(monkeypatch: pytest.MonkeyPatch) -> None:
    from foresight_x.orchestration.llm_gateway import LLMGateway, LLMProviderClient

    monkeypatch.setenv("FX_CHAOS", "1")
    apply_env_leg({TARGET_LLM_PRIMARY: ChaosProfile(status=500, outage=True)})

    class OkClient:
        def complete(self, *_a, **_k):
            return "fallback-ok"

    gw = LLMGateway(
        [
            LLMProviderClient(provider="openai", model="primary", client=object()),
            LLMProviderClient(provider="openai", model="fallback", client=OkClient()),
        ],
        max_retries=1,
    )
    out = gw.complete("hi")
    assert out == "fallback-ok"
    assert gw.last_call is not None
    assert gw.last_call.fallback_reason


def test_chaos_api_set_and_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FX_CHAOS", "1")
    c = TestClient(app)
    r = c.post(
        "/api/_chaos/tavily",
        json={"outage": True, "error_rate": 0, "latency_ms": 0, "latency_jitter_ms": 0, "partial_json": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("target") == TARGET_TAVILY
    listed = c.get("/api/_chaos").json()
    assert TARGET_TAVILY in listed.get("profiles", {})
    c.delete("/api/_chaos/tavily")
