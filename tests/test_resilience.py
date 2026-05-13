from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from foresight_x.config import Settings
from foresight_x.orchestration.pipeline import PipelineContext, run_pipeline
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


def test_structured_predict_prompt_template_compat():
    class FakeLLM:
        def structured_predict(self, _output_cls, _prompt, **_kwargs):
            if isinstance(_prompt, str):
                raise TypeError("expects prompt template")
            return {"ok": True}

    llm = FakeLLM()
    out = structured_predict(llm, dict, "hello")
    assert out == {"ok": True}


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
