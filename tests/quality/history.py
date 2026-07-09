"""Append-only DGS trend log.

Every quality-e2e run appends ONE compact JSON line to ``dgs_history.jsonl``.
Unlike ``tests/quality/reports/`` (gitignored, can be large/binary), this file
is deliberately tiny and committed to git so that:

  1. DGS weight/threshold calibration (currently judgment-based, see
     ``metrics.dgs_weights``) has real longitudinal data to calibrate against
     once enough runs accumulate, instead of staying a one-time guess forever.
  2. ``git log -p tests/quality/dgs_history.jsonl`` doubles as an audit trail
     of how measured quality moved run-over-run and model-over-model.

Nothing here calls an LLM or costs money — it's pure bookkeeping over an
already-produced report dict.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_HISTORY_PATH = Path(__file__).parent / "dgs_history.jsonl"


def history_path() -> Path:
    return _HISTORY_PATH


def append_dgs_history(report: dict[str, Any], *, path: Path | None = None) -> Path:
    p = path or _HISTORY_PATH
    gate = report.get("gate") or {}
    row = {
        "run_id": report.get("run_id"),
        "timestamp": report.get("timestamp"),
        "commit_sha": report.get("commit_sha"),
        "model_id": report.get("model_id"),
        "repeat": report.get("repeat", 1),
        "scenario_count": len(report.get("scenarios") or []),
        "mean_dgs": gate.get("mean_dgs"),
        "gate_pass": gate.get("pass"),
        "scenario_pass_count": gate.get("scenario_pass_count"),
        "scenario_total": gate.get("scenario_total"),
        "errors": gate.get("errors"),
        "per_scenario_dgs": {
            str(s.get("scenario_id")): float((s.get("metrics") or {}).get("dgs", 0.0))
            for s in report.get("scenarios") or []
        },
    }
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, sort_keys=True) + "\n")
    return p


def load_dgs_history(path: Path | None = None) -> list[dict[str, Any]]:
    p = path or _HISTORY_PATH
    if not p.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows
