"""Offline unit tests for the DGS trend history log — $0, no API calls."""

from __future__ import annotations

from pathlib import Path

from tests.quality.history import append_dgs_history, load_dgs_history


def _report(run_id: str, mean_dgs: float) -> dict:
    return {
        "run_id": run_id,
        "timestamp": "2026-07-08T00:00:00Z",
        "commit_sha": "abc123",
        "model_id": "gpt-4o-mini",
        "repeat": 1,
        "gate": {
            "pass": True,
            "mean_dgs": mean_dgs,
            "scenario_pass_count": 2,
            "scenario_total": 2,
            "errors": 0,
        },
        "scenarios": [
            {"scenario_id": "s1", "metrics": {"dgs": mean_dgs}},
            {"scenario_id": "s2", "metrics": {"dgs": mean_dgs}},
        ],
    }


def test_append_and_load_round_trip(tmp_path: Path) -> None:
    p = tmp_path / "dgs_history.jsonl"
    append_dgs_history(_report("run-1", 0.80), path=p)
    append_dgs_history(_report("run-2", 0.85), path=p)

    rows = load_dgs_history(path=p)
    assert len(rows) == 2
    assert rows[0]["run_id"] == "run-1"
    assert rows[1]["mean_dgs"] == 0.85
    assert rows[1]["per_scenario_dgs"] == {"s1": 0.85, "s2": 0.85}


def test_load_dgs_history_missing_file_returns_empty(tmp_path: Path) -> None:
    assert load_dgs_history(path=tmp_path / "nope.jsonl") == []


def test_load_dgs_history_skips_malformed_lines(tmp_path: Path) -> None:
    p = tmp_path / "dgs_history.jsonl"
    p.write_text('{"run_id": "ok"}\nnot json\n\n', encoding="utf-8")
    rows = load_dgs_history(path=p)
    assert len(rows) == 1
    assert rows[0]["run_id"] == "ok"
