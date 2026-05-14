from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

from foresight_x.config import load_settings
from scripts import rebuild_graph as rg


def _sanitized(user_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", user_id.strip())[:120]


class _DummyTemporalGraphMemory:
    def __init__(self, user_id: str, *, settings=None) -> None:
        self.user_id = user_id
        self.settings = settings
        self.store = SimpleNamespace(path=settings.graph_dir / f"{_sanitized(user_id)}.json")
        self.recorded: list[object] = []

    def record_decision_trace(self, trace: object) -> None:
        self.recorded.append(trace)


def _write_trace(path: Path, active_user_id: str | None) -> None:
    payload: dict[str, str] = {}
    if active_user_id is not None:
        payload["active_user_id"] = active_user_id
    path.write_text(json.dumps(payload), encoding="utf-8")


def _patch_runtime(monkeypatch, tmp_path: Path) -> None:
    settings = load_settings().model_copy(update={"foresight_data_dir": tmp_path / "data"})
    monkeypatch.setattr(rg, "load_settings", lambda: settings)
    monkeypatch.setattr(rg, "TemporalGraphMemory", _DummyTemporalGraphMemory)

    def _fake_validate_json(raw: str):
        obj = json.loads(raw)
        return SimpleNamespace(user_state=SimpleNamespace(active_user_id=obj.get("active_user_id")))

    monkeypatch.setattr(rg.DecisionTrace, "model_validate_json", staticmethod(_fake_validate_json))


def test_rebuild_graph_uses_sanitized_store_path_for_delete(monkeypatch, tmp_path: Path) -> None:
    _patch_runtime(monkeypatch, tmp_path)
    traces = tmp_path / "traces"
    traces.mkdir(parents=True, exist_ok=True)
    user_id = "bob@example.com"
    _write_trace(traces / "t1.json", user_id)
    settings = rg.load_settings()
    graph_path = settings.graph_dir / f"{_sanitized(user_id)}.json"
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text("old", encoding="utf-8")

    stats = rg.rebuild_graph(user_id, traces, dry_run=False)

    assert stats.ingested == 1
    assert not graph_path.exists()


def test_rebuild_graph_strict_mode_skips_missing_user_id(monkeypatch, tmp_path: Path) -> None:
    _patch_runtime(monkeypatch, tmp_path)
    traces = tmp_path / "traces"
    traces.mkdir(parents=True, exist_ok=True)
    _write_trace(traces / "t1.json", None)
    _write_trace(traces / "t2.json", "Bob")

    stats = rg.rebuild_graph("Bob", traces, dry_run=True)

    assert stats.scanned == 2
    assert stats.parsed_ok == 2
    assert stats.ingested == 1
    assert stats.skipped_missing_user_id == 1
    assert stats.skipped_other_user == 0


def test_rebuild_graph_allow_missing_user_id_opt_in(monkeypatch, tmp_path: Path) -> None:
    _patch_runtime(monkeypatch, tmp_path)
    traces = tmp_path / "traces"
    traces.mkdir(parents=True, exist_ok=True)
    _write_trace(traces / "t1.json", None)
    _write_trace(traces / "t2.json", "Alice")
    _write_trace(traces / "t3.json", "Bob")

    stats = rg.rebuild_graph("Bob", traces, dry_run=True, allow_missing_user_id=True)

    assert stats.scanned == 3
    assert stats.parsed_ok == 3
    assert stats.ingested == 2
    assert stats.skipped_missing_user_id == 0
    assert stats.skipped_other_user == 1
