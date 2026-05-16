from __future__ import annotations

from foresight_x.chat.manual_decision_mode import (
    build_manual_decision_confirmation,
    decision_topic_snippet,
)


def test_decision_topic_snippet_strips_should_i() -> None:
    q = "Should I get a Leo Messi jersey or spend that money on hotels?"
    topic = decision_topic_snippet(q)
    assert "should i" not in topic.lower()
    assert "jersey" in topic.lower() or "hotels" in topic.lower()


def test_build_manual_decision_confirmation_includes_enhanced_question() -> None:
    enhanced = "Should I buy the Messi jersey or allocate the budget to travel hotels?"
    text = build_manual_decision_confirmation(original="messi vs hotels", enhanced=enhanced)
    assert "manually turned on" in text.lower()
    assert enhanced in text
    assert "Yes" in text
