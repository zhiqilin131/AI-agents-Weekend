"""Clarify gate skip_reason semantics."""

from __future__ import annotations

from foresight_x.perception.clarify_gate import run_clarify_gate


def test_empty_input_skip_reason() -> None:
    r = run_clarify_gate("   ", None)
    assert r.need_clarification is False
    assert r.skip_reason == "no_input"


def test_specific_fork_skips_clarification_without_llm() -> None:
    r = run_clarify_gate("Should I take offer A or B?", None)
    assert r.need_clarification is False


def test_help_me_decide_skips_without_llm_memory_gated() -> None:
    """No generic template when LLM unavailable — proceed without blocking clarify card."""
    r = run_clarify_gate("Help me decide", None, purpose="shadow_chat")
    assert r.need_clarification is False
    assert r.clarification_meta.get("memory_gated") is True
    assert r.clarification_meta.get("clarification_suppressed_reason") == "memory_gated_no_llm"
