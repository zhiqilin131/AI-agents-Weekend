"""Persist and load `DecisionTrace` for demos and Harness."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import DecisionTrace


def save_decision_trace(
    trace: DecisionTrace,
    *,
    settings: Settings | None = None,
    traces_dir: Path | None = None,
) -> Path:
    """Write trace JSON to ``data/traces/{decision_id}.json`` (or ``traces_dir``)."""
    s = settings or load_settings()
    root = traces_dir if traces_dir is not None else s.traces_dir
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{trace.decision_id}.json"
    path.write_text(trace.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_decision_trace(
    decision_id: str,
    *,
    settings: Settings | None = None,
    traces_dir: Path | None = None,
) -> DecisionTrace:
    """Load ``data/traces/{decision_id}.json`` into a validated `DecisionTrace`."""
    s = settings or load_settings()
    root = traces_dir if traces_dir is not None else s.traces_dir
    path = root / f"{decision_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Decision trace not found: {path}")
    return DecisionTrace.model_validate_json(path.read_text(encoding="utf-8"))
