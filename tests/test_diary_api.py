"""Diary HTTP API: generation, sources, save-insight."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from foresight_x.ui.api_server import app


def _write_thread(tmp_path: Path, user_id: str, thread_id: str) -> None:
    d = tmp_path / "chat_threads" / user_id
    d.mkdir(parents=True, exist_ok=True)
    thread = {
        "thread_id": thread_id,
        "user_id": user_id,
        "title": "t",
        "created_at": "2026-05-09T10:00:00Z",
        "updated_at": "2026-05-09T10:00:00Z",
        "mode": "normal",
        "messages": [
            {
                "id": "dm1",
                "role": "user",
                "content": "Ship the diary feature today",
                "created_at": "2026-05-09T17:00:00Z",
                "status": "complete",
                "metadata": {"mode": "normal"},
            }
        ],
        "memory_events": [],
        "dismissed_suggestions": {"role_mode": False, "decision_report": False},
        "linked_decision_ids": [],
        "working_summary": "",
        "temporary_context": [],
        "clarification_events": [],
        "clarification_state": {"answered_dimensions": [], "skipped_dimensions": []},
    }
    (d / f"{thread_id}.json").write_text(json.dumps(thread), encoding="utf-8")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "")
    return TestClient(app)


def test_diary_sources_and_generate_roundtrip(client: TestClient, tmp_path: Path) -> None:
    _write_thread(tmp_path, "demo_user", "api-thr")
    r = client.get("/api/diary/sources/2026-05-09", params={"timezone": "UTC"})
    assert r.status_code == 200
    body = r.json()
    assert body["source_counts"]["chat_messages"] >= 1
    assert len(body["thread_refs"]) >= 1

    g = client.post("/api/diary/generate", json={"date": "2026-05-09", "timezone": "UTC"})
    assert g.status_code == 200
    gj = g.json()
    assert gj["ok"] is True
    assert gj.get("empty") is False
    entry = gj["entry"]
    assert entry["memory_indexed"] is False
    assert "dm1" in entry["linked_message_ids"]

    month = client.get("/api/diary/entries", params={"month": "2026-05"})
    assert month.status_code == 200
    days = month.json()["days"]
    row = next(x for x in days if x["date"] == "2026-05-09")
    assert row["has_entry"] is True

    one = client.get("/api/diary/entries/2026-05-09")
    assert one.status_code == 200
    assert one.json()["id"] == entry["id"]


def test_diary_generate_empty_without_force(client: TestClient) -> None:
    r = client.post("/api/diary/generate", json={"date": "2026-02-01", "timezone": "UTC"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("empty") is True
    assert "source_diagnostics" in body


def test_diary_save_insight_writes_profile_memory(client: TestClient, tmp_path: Path) -> None:
    _write_thread(tmp_path, "demo_user", "api-thr2")
    g = client.post("/api/diary/generate", json={"date": "2026-05-09", "timezone": "UTC", "force": True})
    entry_id = g.json()["entry"]["id"]

    bad = client.post(f"/api/diary/entries/{entry_id}/save-insight", json={"insight_text": " x ", "confirmed": False})
    assert bad.status_code == 400

    ok = client.post(
        f"/api/diary/entries/{entry_id}/save-insight",
        json={"insight_text": "Prioritize shipping diary UX first.", "confirmed": True},
    )
    assert ok.status_code == 200
    prof = client.get("/api/profile").json()
    texts = [f.get("text") for f in prof.get("memory_facts", [])]
    assert any("diary UX" in str(t) for t in texts)

    diary = client.get("/api/diary/entries/2026-05-09").json()
    assert diary["memory_status"] == "saved_selected_insights"


def test_diary_not_in_memory_retrieval_module() -> None:
    import foresight_x.retrieval.memory as mem

    src = Path(mem.__file__).read_text(encoding="utf-8")
    assert "diary" not in src.lower()
