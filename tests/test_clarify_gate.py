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


def test_help_me_decide_fast_template_without_llm() -> None:
    r = run_clarify_gate("Help me decide", None, purpose="shadow_chat")
    assert r.need_clarification is True
    assert r.clarification_meta.get("fast_path") is True
    assert r.questions and len(r.questions) >= 1
    assert "clarification_fast_gate_ms" in r.clarification_meta
    assert r.clarification_meta.get("clarification_shown") is True
