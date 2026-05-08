"""Expand selected memory candidates into compact source-grounded evidence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _safe_text(value: Any, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1] + "…"


def _candidate_field(candidate: Any, key: str, default: Any = None) -> Any:
    if isinstance(candidate, dict):
        return candidate.get(key, default)
    return getattr(candidate, key, default)


def _trace_compact_excerpt(payload: dict[str, Any], max_chars_per_memory: int) -> str:
    original = _safe_text(payload.get("original_user_input"), 260)
    us = payload.get("user_state") if isinstance(payload.get("user_state"), dict) else {}
    raw_input = _safe_text(us.get("raw_input"), 260)
    rec = payload.get("recommendation") if isinstance(payload.get("recommendation"), dict) else {}
    chosen = _safe_text(rec.get("chosen_option_id"), 80)
    reason = _safe_text(rec.get("reasoning"), 280)
    parts: list[str] = []
    if original:
        parts.append(f"Original input: {original}")
    if raw_input and raw_input != original:
        parts.append(f"Situation: {raw_input}")
    if chosen:
        parts.append(f"Chosen option id: {chosen}")
    if reason:
        parts.append(f"Recommendation summary: {reason}")
    return _safe_text(" ".join(parts), max_chars_per_memory)


def expand_selected_memories_to_evidence(
    selected: list[Any],
    traces_dir: str | Path,
    max_chars_per_memory: int = 600,
) -> list[dict[str, Any]]:
    """Create compact source-grounded evidence objects for selected memory rows."""
    root = Path(traces_dir)
    out: list[dict[str, Any]] = []
    for cand in selected:
        did = str(_candidate_field(cand, "decision_id", "") or "").strip()
        if not did:
            continue
        theme = str(_candidate_field(cand, "theme", "general") or "general")
        summary = _safe_text(_candidate_field(cand, "text", ""), 320)
        ts = str(_candidate_field(cand, "timestamp", "") or "")
        oq = _candidate_field(cand, "outcome_quality", None)
        outcome = ""
        source_excerpt = ""
        source_path = str(root / f"{did}.json")
        try:
            path = root / f"{did}.json"
            payload = json.loads(path.read_text(encoding="utf-8"))
            source_excerpt = _trace_compact_excerpt(payload, max_chars_per_memory)
            if not ts:
                ts = str(payload.get("timestamp", "") or "")
            mem = payload.get("memory") if isinstance(payload.get("memory"), dict) else {}
            for row in mem.get("similar_past_decisions", []) if isinstance(mem.get("similar_past_decisions"), list) else []:
                if not isinstance(row, dict):
                    continue
                if str(row.get("decision_id", "")).strip() != did:
                    continue
                if not outcome:
                    outcome = _safe_text(row.get("outcome", ""), 240)
                if oq is None:
                    q = row.get("outcome_quality")
                    if isinstance(q, (int, float)):
                        oq = int(q)
        except Exception:
            # Missing/invalid traces are expected in some environments; keep row minimal.
            pass
        out.append(
            {
                "decision_id": did,
                "theme": theme or "general",
                "memory_summary": summary,
                "source_excerpt": source_excerpt,
                "outcome": outcome,
                "outcome_quality": oq,
                "timestamp": ts,
                "source_path": source_path,
            }
        )
    return out
