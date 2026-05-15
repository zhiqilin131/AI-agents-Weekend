from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import foresight_x.ui.api_server as api_server
from foresight_x.ui.api_server import app


class _FakeShadowTurnOut:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.thread_only_items = []
        self.profile_record_texts = []
        self.profile_memory_events = []
        self.used_memory_facts = []
        self.memory_confirmation_question = None


class _FakeTrace:
    def __init__(self, decision_id: str = "d-stream") -> None:
        self.decision_id = decision_id

    def model_dump(self, mode: str = "json") -> dict:
        return {"decision_id": self.decision_id, "user_state": {"raw_input": "x"}}


class _DecisionIntent:
    intent = "decision_candidate"
    confidence = 0.88


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


def test_shadow_stream_yes_after_suggestion_auto_generates_decision_report(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    t = c.post("/api/shadow-chat/threads", json={}).json()["thread"]
    tid = t["thread_id"]

    with patch("foresight_x.ui.api_server.detect_chat_intent", return_value=_DecisionIntent()):
        with patch("foresight_x.ui.api_server.run_shadow_turn", return_value=_FakeShadowTurnOut("I can help you compare.")):
            with c.stream(
                "POST",
                f"/api/shadow-chat/threads/{tid}/stream",
                json={"message": "Should I join company A or company B?", "client_turn_seq": 1},
            ) as res1:
                assert res1.status_code == 200
                raw1 = "".join(res1.iter_text())
    assert "decision_suggestion" in raw1

    with patch("foresight_x.ui.api_server.run_pipeline", return_value=_FakeTrace("d-stream-yes")):
        with c.stream(
            "POST",
            f"/api/shadow-chat/threads/{tid}/stream",
            json={"message": "yes", "client_turn_seq": 2},
        ) as res2:
            assert res2.status_code == 200
            raw2 = "".join(res2.iter_text())
    assert "d-stream-yes" in raw2

