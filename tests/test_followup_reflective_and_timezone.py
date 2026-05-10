"""Follow-up reflective outcome API, profile timezone, and notify pruning."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from foresight_x.config import Settings
from foresight_x.harness.decision_followup import prune_followup_notify_displays
from foresight_x.harness.trace import save_decision_trace
from foresight_x.profile.store import load_user_profile
from foresight_x.ui import api_server as api_mod
from foresight_x.ui.api_server import app
from tests.test_decision_followup import _minimal_trace


def test_patch_profile_timezone(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TAVILY_API_KEY", "")
    c = TestClient(app)
    r = c.patch("/api/profile/timezone", json={"timezone": "America/Chicago"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("timezone") == "America/Chicago"
    s = Settings()
    p = load_user_profile(s)
    assert p.timezone == "America/Chicago"


def test_reflective_outcome_updates_trace_without_followup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setattr(api_mod, "apply_outcome_to_memory", lambda *a, **k: None)
    monkeypatch.setattr(api_mod, "append_evaluation_log", lambda *a, **k: None)

    s = Settings()
    tr = _minimal_trace("d-reflect", raw="Should I switch teams?", decision_type="career")
    save_decision_trace(tr, settings=s)

    c = TestClient(app)
    r = c.post(
        "/api/decisions/d-reflect/reflective-outcome",
        json={
            "chosen_option": None,
            "outcome_status": "went_well",
            "outcome_text": "Happy with the outcome",
            "satisfaction": 5,
            "save_lesson_to_memory": False,
        },
    )
    assert r.status_code == 200
    assert r.json().get("decision_id") == "d-reflect"
    out_path = s.outcomes_dir / "d-reflect.json"
    assert out_path.is_file()
    data = json.loads(out_path.read_text(encoding="utf-8"))
    assert data.get("reflective_outcome_status") == "went_well"
    assert data.get("outcome_source") == "manual_history"


def test_prune_followup_notify_displays(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    s = Settings()
    root = s.followups_dir / ".notify"
    root.mkdir(parents=True, exist_ok=True)
    old = [
        {"followup_id": "a", "at": "2020-01-01T12:00:00Z", "local_date": "2020-01-01"},
        {"followup_id": "b", "at": "2099-01-01T12:00:00Z", "local_date": "2099-01-01"},
    ]
    (root / "u1.json").write_text(json.dumps({"displays": old}), encoding="utf-8")
    n = prune_followup_notify_displays(settings=s, keep_days=14)
    assert n == 1
    data = json.loads((root / "u1.json").read_text(encoding="utf-8"))
    assert len(data.get("displays") or []) == 1
    assert data["displays"][0]["followup_id"] == "b"
