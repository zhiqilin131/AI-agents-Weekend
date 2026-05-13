from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from foresight_x.config import Settings
from foresight_x.orchestration.pipeline import PipelineContext, run_pipeline
from foresight_x.resilience.runtime import reset_resilience_runtime_state
from foresight_x.retrieval.tavily_client import TavilyGateway
from foresight_x.structured_predict import structured_predict
from foresight_x.ui.api_server import app


def test_resilience_health_endpoint_shape():
    c = TestClient(app)
    r = c.get("/api/health/resilience")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert "report_card" in body
    assert "runtime" in body


def test_tavily_gateway_chaos_outage_returns_empty(monkeypatch):
    monkeypatch.setenv("CHAOS_TAVILY_MODE", "outage")
    monkeypatch.setattr("foresight_x.retrieval.tavily_client.TavilyClient", lambda key: SimpleNamespace(search=lambda *_a, **_k: {}))
    g = TavilyGateway("dummy")
    out = g.search_as_facts("latest market updates")
    assert out == []


def test_structured_predict_retries_transient_once(monkeypatch):
    reset_resilience_runtime_state()
    class FakeLLM:
        __module__ = "llama_index.testdoubles"

        def __init__(self):
            self.calls = 0

        def structured_predict(self, _output_cls, _prompt, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise TimeoutError("transient timeout")
            return {"ok": True}

    monkeypatch.delenv("CHAOS_OPENAI_MODE", raising=False)
    llm = FakeLLM()
    out = structured_predict(llm, dict, "hello")
    assert out == {"ok": True}
    assert llm.calls == 2


def test_structured_predict_uses_secondary_failover(monkeypatch):
    reset_resilience_runtime_state()
    class FailingLLM:
        __module__ = "llama_index.testdoubles"

        def structured_predict(self, _output_cls, _prompt, **_kwargs):
            raise TimeoutError("primary timeout")

    class SecondaryLLM:
        __module__ = "llama_index.testdoubles"

        def structured_predict(self, _output_cls, _prompt, **_kwargs):
            return {"source": "secondary"}

    monkeypatch.setattr(
        "foresight_x.orchestration.llm_factory.build_secondary_openai_llm",
        lambda *_a, **_k: SecondaryLLM(),
    )
    out = structured_predict(FailingLLM(), dict, "hello")
    assert out == {"source": "secondary"}


def test_run_pipeline_stage_resume_with_partial_state(tmp_path, monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "")
    s = Settings(foresight_data_dir=tmp_path)
    ctx = PipelineContext(settings=s, llm=None, user_memory=None, world=None)
    base = run_pipeline(ctx, "Should I switch jobs this quarter?", persist_trace=False, decision_id="base-trace")
    resumed = run_pipeline(
        ctx,
        "Should I switch jobs this quarter?",
        persist_trace=False,
        decision_id="resume-trace",
        resume_from_stage="simulate",
        resume_partial=base.model_dump(mode="json"),
    )
    assert resumed.decision_id == "resume-trace"
    assert resumed.recommendation.chosen_option_id
