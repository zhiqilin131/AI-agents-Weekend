"""Fast clarification gate (deterministic, no LLM)."""

from __future__ import annotations

from foresight_x.perception.clarification_gate import (
    default_clarification_state,
    should_show_clarification_fast,
)
from foresight_x.perception.clarification_engine import run_personalized_clarify_gate_timed


def _thread(**kwargs):
    base = {
        "messages": [],
        "clarification_events": [],
        "clarification_state": default_clarification_state(),
    }
    base.update(kwargs)
    return base


def test_empty_message_no_clarify() -> None:
    r = should_show_clarification_fast("", [], _thread())
    assert r.should_ask is False
    assert r.reason == "empty_chat"


def test_help_me_decide_signals_memory_gated_llm() -> None:
    r = should_show_clarification_fast(
        "Help me decide",
        [],
        _thread(messages=[{"role": "user", "content": "Help me decide"}]),
        interaction_purpose="shadow_chat",
    )
    assert r.should_ask is True
    assert r.requires_llm is True
    assert not r.fast_question


def test_specific_fork_no_clarify() -> None:
    r = should_show_clarification_fast(
        "Should I take offer A or offer B?",
        [],
        _thread(messages=[{"role": "user", "content": "Should I take offer A or offer B?"}]),
        interaction_purpose="shadow_chat",
    )
    assert r.should_ask is False


def test_should_i_without_fork_still_counts_as_decision_for_clarify() -> None:
    """Regression: heuristic intent stays below decision_candidate threshold for lone 'should i …'."""
    r = should_show_clarification_fast(
        "Should I go to find my roommate?",
        [],
        _thread(messages=[{"role": "user", "content": "Should I go to find my roommate?"}]),
        interaction_purpose="shadow_chat",
    )
    assert r.should_ask is True
    assert r.reason != "not_decision_or_help_request"


def test_recent_skip_suppresses() -> None:
    st = default_clarification_state()
    st["suppress_clarify_until_user_count"] = 99
    r = should_show_clarification_fast(
        "Help me decide",
        [],
        _thread(
            messages=[{"role": "user", "content": "Help me decide"}],
            clarification_state=st,
        ),
        interaction_purpose="shadow_chat",
    )
    assert r.should_ask is False
    assert r.reason == "recently_skipped"


def test_social_issue_memory_gated_not_template() -> None:
    r = should_show_clarification_fast(
        "Should I speak up about discrimination I saw?",
        [],
        _thread(
            messages=[{"role": "user", "content": "Should I speak up about discrimination I saw?"}],
        ),
        interaction_purpose="shadow_chat",
    )
    assert r.should_ask is True
    assert r.requires_llm is True
    assert r.domain == "social_issue"
    assert not r.fast_question


def test_timed_llm_returns_none_on_bad_llm() -> None:
    out, ms = run_personalized_clarify_gate_timed("Help me decide", None, timeout_s=0.01)
    assert out is None
    assert ms is None
