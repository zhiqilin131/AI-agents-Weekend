"""Query enhancement should not replace the user's text when the model over-compresses."""

from __future__ import annotations

from foresight_x.perception import query_enhance as qe


def test_pick_enhanced_keeps_raw_when_enhancement_too_short_vs_long_body() -> None:
    body = (
        "My friend broke up with his ex-girlfriend, Amy, because their values diverged. "
        "Yesterday they ran into each other at our CSA banquet. Should they take a picture? "
        "Everyone is watching. Amy is now in a serious relationship with Vincent; "
        "Kevin has been with Summer for 6+ years. " * 2
    )
    # Model-style over-compression: one sentence, drops names and social pressure.
    bad = "Should David and Amy take a picture at the banquet given social pressure and her new relationship?"
    assert qe._pick_enhanced_or_raw(body, bad) == body


def test_pick_enhanced_accepts_proportionate_rewrite() -> None:
    body = "Should I accept offer A or wait for B? Deadline Friday."
    ok = (
        "Should I accept job offer A or wait for alternative B, given the Friday deadline?"
    )
    assert qe._pick_enhanced_or_raw(body, ok) == ok


def test_pick_enhanced_rejects_refusal() -> None:
    body = "Should I do X or Y?"
    assert qe._pick_enhanced_or_raw(body, "I can't assist with that.") == body
