"""FOR-20: pipeline completes with deterministic fallbacks when LLM is unavailable."""

from __future__ import annotations

from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.orchestration.degradation_policy import llm_unavailable
from foresight_x.orchestration.pipeline import PipelineContext, iter_pipeline_events, run_pipeline


class _BrokenLLM:
    """Simulates a gateway that always errors on structured calls."""

    def structured_predict(self, *_a, **_k):
        raise RuntimeError("all providers unavailable")


@pytest.fixture
def isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    return Settings(foresight_data_dir=tmp_path)


def test_llm_unavailable_detects_force_offline() -> None:
    class Offline:
        _fx_force_offline = True

    assert llm_unavailable(Offline(), probe=False) is True
    assert llm_unavailable(None, probe=False) is True


def test_run_pipeline_completes_with_no_llm(isolated_settings: Settings) -> None:
    ctx = PipelineContext(settings=isolated_settings, llm=None, user_memory=None, world=None)
    trace = run_pipeline(
        ctx,
        "Should I accept a new job offer this month? I feel anxious about the deadline.",
        decision_id="degraded-offline",
        persist_trace=False,
    )
    assert trace.decision_id == "degraded-offline"
    assert trace.recommendation.chosen_option_id
    assert trace.options
    assert trace.degradations
    assert any(d.stage for d in trace.degradations)
    assert trace.runtime is not None
    assert "deterministic" in (trace.runtime.provider_per_stage.get("infer") or "")


def test_run_pipeline_completes_when_llm_always_raises(isolated_settings: Settings) -> None:
    ctx = PipelineContext(settings=isolated_settings, llm=_BrokenLLM(), user_memory=None, world=None)
    trace = run_pipeline(
        ctx,
        "Should I switch teams before the end of the quarter?",
        decision_id="degraded-broken-llm",
        persist_trace=False,
    )
    assert trace.recommendation.chosen_option_id
    assert trace.options
    assert trace.reflection.possible_errors


def test_iter_pipeline_events_emits_degraded_sse(isolated_settings: Settings) -> None:
    ctx = PipelineContext(settings=isolated_settings, llm=None, user_memory=None, world=None)
    events = list(
        iter_pipeline_events(
            ctx,
            "Need to decide on relocating for work within two weeks.",
            persist_trace=False,
        )
    )
    degraded = [e for e in events if e.get("event") == "degraded"]
    complete = next((e for e in events if e.get("event") == "complete"), None)
    assert complete is not None
    assert degraded
    trace = complete.get("trace")
    assert isinstance(trace, dict)
    assert trace.get("recommendation", {}).get("chosen_option_id")
