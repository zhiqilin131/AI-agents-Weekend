from pathlib import Path

from fastapi.testclient import TestClient

from foresight_x.ui.api_server import app


def test_unified_chat_respects_dismissed_suggestion(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    first = c.post("/api/chat/unified", json={"message": "pretend to be a wizard", "user_action": "send_message"})
    assert first.status_code == 200
    body = first.json()
    assert body["suggestion"]["type"] == "role_mode"
    tid = body["thread_id"]

    dis = c.post("/api/chat/unified", json={"thread_id": tid, "user_action": "dismiss_suggestion"})
    assert dis.status_code == 200

    again = c.post("/api/chat/unified", json={"thread_id": tid, "message": "roleplay with me", "user_action": "send_message"})
    assert again.status_code == 200
    assert again.json()["suggestion"] is None


def test_enter_role_mode_changes_thread_mode(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    first = c.post("/api/chat/unified", json={"message": "hello", "user_action": "send_message"})
    tid = first.json()["thread_id"]
    out = c.post("/api/chat/unified", json={"thread_id": tid, "user_action": "enter_role_mode"})
    assert out.status_code == 200
    assert out.json()["mode"] == "roleplay"

