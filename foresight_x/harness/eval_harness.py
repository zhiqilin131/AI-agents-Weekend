"""Minimal v0 eval harness over saved traces and outcomes."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import HarnessReport


def _count_json_files(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for p in path.glob("*.json") if p.is_file())


def eval_harness(
    *,
    settings: Settings | None = None,
    traces_dir: Path | None = None,
    outcomes_dir: Path | None = None,
) -> HarnessReport:
    """Return minimal aggregate counts for v0 demos."""
    s = settings or load_settings()
    tr_dir = traces_dir if traces_dir is not None else s.traces_dir
    out_dir = outcomes_dir if outcomes_dir is not None else s.outcomes_dir
    trace_count = _count_json_files(tr_dir)
    outcome_count = _count_json_files(out_dir)
    notes = (
        f"v0 report: {trace_count} trace(s), {outcome_count} outcome(s). "
        "Use this as a baseline before richer calibration metrics."
    )
    return HarnessReport(
        trace_count=trace_count,
        outcome_count=outcome_count,
        notes=notes,
    )
