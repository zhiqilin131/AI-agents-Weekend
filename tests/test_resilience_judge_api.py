"""FOR-17: judge-pack and isolated smoke-run APIs."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from foresight_x.config import Settings
from foresight_x.resilience.judge_demo import build_judge_pack, run_isolated_smoke_pipeline
from foresight_x.ui.api_server import app


def test_build_judge_pack_shape() -> None:
    pack = build_judge_pack()
    assert "health" in pack
    assert "features" in pack
    assert "artifacts" in pack
    assert pack.get("smoke_run_available") is True


def test_isolated_smoke_pipeline_completes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "")
    row = run_isolated_smoke_pipeline(settings=Settings(foresight_data_dir=tmp_path))
    assert row.get("isolated") is True
    assert row.get("pass") is True
    assert not row.get("errors")
    assert row.get("chosen_option_id")


def test_resilience_judge_pack_endpoint() -> None:
    c = TestClient(app)
    r = c.get("/api/resilience/judge-pack")
    assert r.status_code == 200
    body = r.json()
    assert body.get("features")
    assert body.get("health")


def test_resilience_smoke_run_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TAVILY_API_KEY", "")
    c = TestClient(app)
    r = c.post("/api/resilience/smoke-run")
    assert r.status_code == 200
    body = r.json()
    assert body.get("pass") is True
    assert body.get("isolated") is True
    assert body.get("stability_score") is not None
    assert body.get("assertions")


def test_collect_degradations_merges_sse_when_trace_empty() -> None:
    from foresight_x.resilience.judge_demo import _collect_degradations

    events = [
        {
            "event": "degraded",
            "degraded": {
                "stage": "infer",
                "provider": "none",
                "reason": "LLM unavailable",
                "fallback_path": "rule_options",
            },
        },
        {"event": "complete", "trace": {"decision_id": "d1", "degradations": []}},
    ]
    merged = _collect_degradations(events[-1]["trace"], events)
    assert len(merged) == 1
    assert merged[0]["stage"] == "infer"


def test_resilience_smoke_run_stream_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TAVILY_API_KEY", "")
    c = TestClient(app)
    with c.stream("POST", "/api/resilience/smoke-run/stream") as r:
        assert r.status_code == 200
        chunks = "".join(r.iter_text())
    assert "data:" in chunks
    assert '"type": "result"' in chunks or '"type":"result"' in chunks
