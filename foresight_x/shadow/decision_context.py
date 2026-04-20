"""Inject recent Foresight decision traces + vector memory into Shadow chat (not only static profile)."""

from __future__ import annotations

from foresight_x.config import Settings, load_settings
from foresight_x.harness.trace import load_decision_trace
from foresight_x.harness.trace_index import list_traces
from foresight_x.profile.merge import merge_profile_into_user_state
from foresight_x.retrieval.memory import UserMemory
from foresight_x.schemas import (
    Reversibility,
    TimePressure,
    UserProfile,
    UserState,
)

_MAX_CONTEXT_CHARS = 10_000
_MAX_TRACES = 10
_MAX_CHARS_PER_TRACE = 1_600
_MAX_MEMORY_DECISIONS = 6


def build_user_state_for_shadow_retrieval(last_user_message: str, profile: UserProfile) -> UserState:
    """Minimal ``UserState`` so memory retrieval query aligns with this turn + profile."""
    text = (last_user_message or "").strip()[:8000]
    base = UserState(
        raw_input=text,
        goals=[],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="shadow_chat",
        decision_type="general",
        reversibility=Reversibility.PARTIAL,
    )
    return merge_profile_into_user_state(base, profile)


def _format_recent_traces_block(settings: Settings) -> str:
    rows = list_traces(settings=settings)[:_MAX_TRACES]
    if not rows:
        return ""

    chunks: list[str] = []
    for row in rows:
        try:
            t = load_decision_trace(row.decision_id, settings=settings)
        except (OSError, FileNotFoundError, ValueError):
            continue
        raw = (t.original_user_input or "").strip() or (t.user_state.raw_input or "").strip()
        if not raw:
            continue
        if len(raw) > _MAX_CHARS_PER_TRACE:
            raw = raw[: _MAX_CHARS_PER_TRACE - 1] + "…"
        rec_id = (t.recommendation.chosen_option_id or "").strip()
        rec_name = ""
        for o in t.options:
            if o.option_id == rec_id:
                rec_name = o.name
                break
        lean = f" · suggestion leaned toward «{rec_name}»" if rec_name else ""
        chunks.append(
            f"- [{row.timestamp[:16]}] {row.decision_type}{lean}\n  {raw}"
        )

    if not chunks:
        return ""

    header = (
        "Recent Foresight decision runs (full saved situations — same pipeline as Decision mode; "
        "the user may refer back to people or stakes from these):\n"
    )
    return header + "\n".join(chunks)


def _format_indexed_memory_block(settings: Settings, user_state: UserState) -> str:
    try:
        um = UserMemory(settings.foresight_user_id, settings=settings)
        mb = um.retrieve(user_state, top_k=_MAX_MEMORY_DECISIONS)
    except Exception:
        return ""

    if not mb.similar_past_decisions:
        return ""

    lines: list[str] = []
    for p in mb.similar_past_decisions:
        summ = (p.situation_summary or "").strip()
        if len(summ) > 900:
            summ = summ[:899] + "…"
        chosen = (p.chosen_option or "").strip()
        ts = (p.timestamp or "")[:16]
        lines.append(f"- [{ts}] Chosen option (label): {chosen}\n  {summ}")

    if not lines:
        return ""

    return (
        "Semantically related indexed past decisions (vector memory — often overlaps traces; "
        "useful when Chroma has ingested outcomes or past runs):\n" + "\n".join(lines)
    )


def build_shadow_decision_context_block(
    *,
    settings: Settings | None = None,
    profile: UserProfile,
    last_user_message: str,
) -> str:
    """Single block for the Shadow system prompt: traces on disk + optional Chroma matches."""
    s = settings or load_settings()
    parts: list[str] = []

    trace_part = _format_recent_traces_block(s)
    if trace_part:
        parts.append(trace_part)

    try:
        us = build_user_state_for_shadow_retrieval(last_user_message, profile)
        mem_part = _format_indexed_memory_block(s, us)
        if mem_part:
            parts.append(mem_part)
    except Exception:
        pass

    if not parts:
        return (
            "No saved Foresight decision traces found yet, and no indexed memory hits. "
            "Rely on structured memory + shadow notes + this conversation."
        )

    out = "\n\n".join(parts)
    if len(out) > _MAX_CONTEXT_CHARS:
        out = out[: _MAX_CONTEXT_CHARS - 24] + "\n…(context truncated)"
    return out
