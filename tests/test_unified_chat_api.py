from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from foresight_x.ui.api_server import app


class _FakeShadowTurnOut:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.thread_only_items = []
        self.profile_record_texts = []


class _FakeTrace:
    def __init__(self, decision_id: str = "d-auto") -> None:
        self.decision_id = decision_id

    def model_dump(self, mode: str = "json") -> dict:
        return {"decision_id": self.decision_id, "user_state": {"raw_input": "x"}}


def test_unified_chat_respects_dismissed_suggestion(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    with patch("foresight_x.ui.api_server.run_shadow_turn", return_value=_FakeShadowTurnOut("Arrr")):
        first = c.post("/api/chat/unified", json={"message": "pretend to be a wizard", "user_action": "send_message"})
    assert first.status_code == 200
    body = first.json()
    assert body["suggestion"]["type"] == "role_mode"
    tid = body["thread_id"]

    dis = c.post("/api/chat/unified", json={"thread_id": tid, "user_action": "dismiss_suggestion"})
    assert dis.status_code == 200

    with patch("foresight_x.ui.api_server.run_shadow_turn", return_value=_FakeShadowTurnOut("Okay")):
        again = c.post("/api/chat/unified", json={"thread_id": tid, "message": "roleplay with me", "user_action": "send_message"})
    assert again.status_code == 200
    assert again.json()["suggestion"] is None


def test_enter_role_mode_changes_thread_mode(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    with patch("foresight_x.ui.api_server.run_shadow_turn", return_value=_FakeShadowTurnOut("Hi")):
        first = c.post("/api/chat/unified", json={"message": "hello", "user_action": "send_message"})
    tid = first.json()["thread_id"]
    out = c.post("/api/chat/unified", json={"thread_id": tid, "user_action": "enter_role_mode"})
    assert out.status_code == 200
    assert out.json()["mode"] == "roleplay"


def test_unified_chat_hard_start_decision_mode_offers_confirmation(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    with patch("foresight_x.ui.api_server.run_shadow_turn", return_value=_FakeShadowTurnOut("Okay.")):
        out = c.post(
            "/api/chat/unified",
            json={"message": "Start decision mode", "user_action": "send_message"},
        )
    assert out.status_code == 200
    body = out.json()
    assert body["mode"] == "shadow"
    assert body["suggestion"]["type"] == "decision_report"
    assert body["decision_trace"] is None
    assert body["pending_action"]["type"] == "decision_report"


def test_unified_chat_yes_after_prompt_auto_generates_report(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    with patch("foresight_x.ui.api_server.run_shadow_turn", return_value=_FakeShadowTurnOut("Tell me more.")):
        first = c.post(
            "/api/chat/unified",
            json={"message": "Should I pick A or B?", "user_action": "send_message"},
        )
    assert first.status_code == 200
    b1 = first.json()
    tid = b1["thread_id"]
    assert b1["suggestion"]["type"] == "decision_report"

    with patch("foresight_x.ui.api_server.run_pipeline", return_value=_FakeTrace("d-yes")):
        second = c.post(
            "/api/chat/unified",
            json={"thread_id": tid, "message": "yes", "user_action": "send_message"},
        )
    assert second.status_code == 200
    b2 = second.json()
    assert b2["mode"] == "decision_report"
    assert b2["decision_trace"]["decision_id"] == "d-yes"

