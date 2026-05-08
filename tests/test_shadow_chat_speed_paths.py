from pathlib import Path

from fastapi.testclient import TestClient

import foresight_x.ui.api_server as api_server
from foresight_x.ui.api_server import app


def test_decision_report_stream_endpoint_exists(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        api_server,
        "iter_pipeline_events",
        lambda *args, **kwargs: iter(
            [
                {"event": "meta", "decision_id": "d1", "timestamp": "2026-01-01T00:00:00Z"},
                {"event": "stage", "stage": "enhance"},
                {"event": "partial", "stage": "enhance", "data": {"user_state": {"raw_input": "x"}}},
                {"event": "complete", "trace": {"decision_id": "d1", "user_state": {"raw_input": "x"}}},
            ]
        ),
    )
    c = TestClient(app)
    t = c.post("/api/shadow-chat/threads", json={}).json()["thread"]
    res = c.post(
        f"/api/shadow-chat/threads/{t['thread_id']}/decision-report/stream",
        json={"decision_prompt": "Should I choose A or B?"},
    )
    assert res.status_code == 200
    assert "text/event-stream" in (res.headers.get("content-type") or "")

