"""Pre-run clarification gate — deterministic fast path + optional timed LLM."""

from __future__ import annotations

import time
from typing import Any

from foresight_x.schemas import UserProfile

from foresight_x.perception.clarify_types import (
    ClarifyGateResult,
    ClarifyOption,
    ClarifyQuestion,
    SkipReason,
    StructuredPredictLLM,
)
from foresight_x.perception.clarification_engine import run_personalized_clarify_gate_timed
from foresight_x.perception.clarification_gate import (
    ClarificationFastResult,
    build_fast_clarify_questions,
    build_timeout_fallback_questions,
    fast_gate_timing_ms,
    should_show_clarification_fast,
)
from foresight_x.perception.personalized_clarify import heuristic_domain

__all__ = [
    "ClarifyGateResult",
    "ClarifyOption",
    "ClarifyQuestion",
    "SkipReason",
    "StructuredPredictLLM",
    "merge_clarification_answers",
    "run_clarify_gate",
]


def merge_clarification_answers(raw: str, answers: dict[str, str] | None) -> str:
    """Append structured answers to the raw prompt for downstream perception."""
    base = raw.strip()
    if not answers:
        return base
    lines = [base, "", "User clarification (structured):"]
    for qid, val in answers.items():
        lines.append(f"- {qid}: {val}")
    return "\n".join(lines)


def _why_fast(fast: ClarificationFastResult) -> str:
    return (
        "This is a quick, domain-specific check so we don't guess what matters most — "
        f"no extra model round-trip ({fast.domain})."
    )


def run_clarify_gate(
    raw: str,
    llm: StructuredPredictLLM | None,
    *,
    profile: UserProfile | None = None,
    recent_messages: list[dict[str, str]] | None = None,
    thread_clarification_events: list[dict[str, Any]] | None = None,
    purpose: str | None = None,
    thread_metadata: dict[str, Any] | None = None,
) -> ClarifyGateResult:
    """Fast gate first; optional smart clarification with strict timeout; deterministic fallback."""
    text = raw.strip()
    events = list(thread_clarification_events or [])
    tm: dict[str, Any]
    if thread_metadata is not None:
        tm = thread_metadata
    else:
        tm = {"messages": [], "clarification_events": events, "clarification_state": {}}

    if not text:
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason="no_input",
            clarification_meta={
                "clarification_fast_gate_ms": 0.0,
                "clarification_used_llm": False,
                "clarification_shown": False,
                "clarification_suppressed_reason": "empty_chat",
            },
        )

    t_fast_start = time.perf_counter()
    fast = should_show_clarification_fast(
        text,
        list(recent_messages or []),
        tm,
        None,
        interaction_purpose=purpose,
    )
    timing: dict[str, Any] = {
        "clarification_fast_gate_ms": fast_gate_timing_ms(t_fast_start),
        "clarification_used_llm": False,
        "clarification_shown": False,
        "clarification_suppressed_reason": "",
    }

    if not fast.should_ask:
        timing["clarification_suppressed_reason"] = fast.reason
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason="not_needed",
            clarification_meta=timing,
        )

    if fast.fast_question and not fast.requires_llm:
        qs = build_fast_clarify_questions(fast)
        if not qs:
            timing["clarification_suppressed_reason"] = "fast_pack_empty"
            return ClarifyGateResult(
                need_clarification=False,
                skip_reason="no_questions",
                clarification_meta=timing,
            )
        timing["clarification_shown"] = True
        timing["clarification_suppressed_reason"] = "none"
        meta = {
            "domain": fast.domain,
            "target_dimension": fast.target_dimension,
            "why_this_question": _why_fast(fast),
            "fast_path": True,
            **timing,
        }
        return ClarifyGateResult(
            need_clarification=True,
            questions=qs,
            clarification_meta=meta,
            skip_reason="none",
        )

    # Smart path — bounded LLM time; if unavailable or timeout, fall back to domain template.
    llm_out, llm_ms = run_personalized_clarify_gate_timed(
        text,
        llm,
        timeout_s=1.5,
        profile=profile,
        recent_messages=recent_messages,
        thread_clarification_events=events,
        interaction_purpose=purpose,
    )
    timing["clarification_llm_ms"] = llm_ms

    if llm_out is not None:
        merged_meta = dict(llm_out.clarification_meta or {})
        merged_meta.update(timing)
        if llm_out.need_clarification and llm_out.questions:
            merged_meta["clarification_used_llm"] = True
            merged_meta["clarification_shown"] = True
            merged_meta["clarification_suppressed_reason"] = "none"
            return ClarifyGateResult(
                need_clarification=True,
                questions=llm_out.questions,
                note=llm_out.note,
                skip_reason="none",
                clarification_meta=merged_meta,
            )
        merged_meta["clarification_used_llm"] = bool(llm_ms is not None and llm is not None)
        merged_meta["clarification_shown"] = False
        merged_meta.setdefault(
            "clarification_suppressed_reason",
            str(llm_out.skip_reason or "not_needed"),
        )
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason=llm_out.skip_reason,
            clarification_meta=merged_meta,
        )

    dom = heuristic_domain(text)
    fb = build_timeout_fallback_questions(dom)
    timing["clarification_shown"] = True
    timing["clarification_suppressed_reason"] = "llm_timeout_fallback" if llm is not None else "no_llm_fallback"
    meta = {
        "domain": dom,
        "why_this_question": (
            "Smart clarification timed out or wasn't available — using a quick domain fallback "
            "so we can still proceed without blocking."
        ),
        "fast_path": True,
        "fallback_after_llm": llm is not None,
        **timing,
    }
    return ClarifyGateResult(
        need_clarification=True,
        questions=fb,
        clarification_meta=meta,
        skip_reason="none",
    )
