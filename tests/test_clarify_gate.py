"""Clarify gate skip_reason semantics."""

from __future__ import annotations

from foresight_x.perception.clarify_gate import run_clarify_gate


def test_empty_input_skip_reason() -> None:
    r = run_clarify_gate("   ", None)
    assert r.need_clarification is False
    assert r.skip_reason == "no_input"


def test_no_llm_skip_reason() -> None:
    r = run_clarify_gate("Should I take offer A or B?", None)
    assert r.need_clarification is False
    assert r.skip_reason == "no_llm"
