"""Backfill existing decision traces and shadow threads into the Graphiti backend.

Usage:
    python -m foresight_x.memory_graph.backfill [--user USER_ID] [--dry-run]

Idempotent: the per-user ingest ledger skips episodes that were already
ingested, so re-running is safe.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from foresight_x.config import load_settings
from foresight_x.memory_graph.graphiti_backend import get_graphiti_backend
from foresight_x.schemas import DecisionTrace


def _iter_traces(traces_dir: Path, *, user_id: str, include_unowned: bool = True):
    for path in sorted(traces_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            owner = str(((data.get("user_state") or {}).get("active_user_id")) or "").strip()
            if owner != user_id and not (include_unowned and owner == ""):
                continue
            yield DecisionTrace.model_validate(data)
        except Exception as exc:
            print(f"  skip {path.name}: {type(exc).__name__}", file=sys.stderr)


def _iter_shadow_turns(threads_dir: Path):
    """Yield (user_text, assistant_text, timestamp) tuples from shadow thread files."""
    if not threads_dir.exists():
        return
    for path in sorted(threads_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        messages = data.get("messages") or []
        pending_user: dict | None = None
        for msg in messages:
            role = str(msg.get("role") or "")
            content = str(msg.get("content") or "").strip()
            if not content:
                continue
            if role == "user":
                pending_user = msg
            elif role == "assistant" and pending_user is not None:
                yield (
                    str(pending_user.get("content") or ""),
                    content,
                    str(pending_user.get("created_at") or msg.get("created_at") or ""),
                )
                pending_user = None


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill memories into Graphiti")
    parser.add_argument("--user", default=None, help="User id (default: settings.foresight_user_id)")
    parser.add_argument("--dry-run", action="store_true", help="Count only; do not ingest")
    parser.add_argument(
        "--owned-only",
        action="store_true",
        help="Skip traces without an active_user_id (default: include them)",
    )
    parser.add_argument("--timeout", type=float, default=1800.0, help="Max seconds to wait for ingest drain")
    args = parser.parse_args()

    settings = load_settings()
    user_id = args.user or settings.foresight_user_id
    backend = get_graphiti_backend(user_id, settings)
    if backend is None:
        print("Graphiti backend unavailable (need graphiti-core + OPENAI_API_KEY, GRAPH_BACKEND != local).")
        return 1

    traces = (
        list(_iter_traces(settings.traces_dir, user_id=user_id, include_unowned=not args.owned_only))
        if settings.traces_dir.exists()
        else []
    )
    shadow_dir = settings.foresight_data_dir / "chat_threads"
    turns = list(_iter_shadow_turns(shadow_dir))
    print(f"user={user_id}")
    print(f"found {len(traces)} decision traces, {len(turns)} shadow turns")
    if args.dry_run:
        return 0

    for trace in traces:
        backend.enqueue_decision_trace(trace)
    for user_text, assistant_text, ts in turns:
        backend.enqueue_shadow_turn(user_text, assistant_text, timestamp=ts or None)

    status = backend.status()
    print(f"queued; ingest_queue_depth={status['ingest_queue_depth']} (LLM extraction runs in background)")
    print("waiting for ingest to drain (Ctrl-C safe: ledger resumes on next run)...")
    drained = backend.wait_for_ingest_drain(timeout=args.timeout)
    status = backend.status()
    print(
        f"done={status['ingest_done_this_session']} errors={status['ingest_errors']} "
        f"total_ingested={status['ingested_total']} drained={drained}"
    )
    return 0 if status["ingest_errors"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
