"""Rebuild per-user temporal graph from saved decision traces."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from foresight_x.config import load_settings
from foresight_x.memory_graph.service import TemporalGraphMemory
from foresight_x.schemas import DecisionTrace


@dataclass
class RebuildStats:
    scanned: int = 0
    parsed_ok: int = 0
    ingested: int = 0
    skipped_missing_user_id: int = 0
    skipped_other_user: int = 0
    parse_errors: int = 0


def rebuild_graph(
    user_id: str,
    traces_dir: Path,
    *,
    dry_run: bool = False,
    allow_missing_user_id: bool = False,
) -> RebuildStats:
    stats = RebuildStats()
    settings = load_settings().model_copy(update={"foresight_user_id": user_id})
    gm = TemporalGraphMemory(user_id, settings=settings)
    # Use the same sanitized path policy as GraphStore to avoid stale graph files.
    graph_path = gm.store.path
    if graph_path.exists() and not dry_run:
        graph_path.unlink()

    for path in sorted(traces_dir.glob("*.json")):
        stats.scanned += 1
        try:
            trace = DecisionTrace.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:
            stats.parse_errors += 1
            continue
        stats.parsed_ok += 1
        trace_user_id = (trace.user_state.active_user_id or "").strip()
        if not trace_user_id:
            if not allow_missing_user_id:
                stats.skipped_missing_user_id += 1
                continue
            trace_user_id = user_id
        if trace_user_id != user_id:
            stats.skipped_other_user += 1
            continue
        stats.ingested += 1
        if not dry_run:
            gm.record_decision_trace(trace)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild one user's graph snapshot from trace files.")
    parser.add_argument("--user-id", required=True, help="User id, e.g. Bob")
    parser.add_argument("--traces-dir", default="data/traces", help="Trace folder (default: data/traces)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and count only, do not write graph")
    parser.add_argument(
        "--allow-missing-user-id",
        action="store_true",
        help="Include traces with missing user id as target user (default: strict skip).",
    )
    args = parser.parse_args()

    stats = rebuild_graph(
        args.user_id,
        Path(args.traces_dir),
        dry_run=args.dry_run,
        allow_missing_user_id=bool(args.allow_missing_user_id),
    )
    mode = "dry-run" if args.dry_run else "write"
    print(
        f"[{mode}] scanned={stats.scanned} parsed_ok={stats.parsed_ok} ingested={stats.ingested} "
        f"skipped_missing_user_id={stats.skipped_missing_user_id} skipped_other_user={stats.skipped_other_user} "
        f"parse_errors={stats.parse_errors} user={args.user_id}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
