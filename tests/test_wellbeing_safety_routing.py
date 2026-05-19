"""Regression tests for wellbeing safety regex and routing edge cases."""

from __future__ import annotations

from foresight_x.slime.therapy_session import save_wellbeing_intake
from foresight_x.slime.wellbeing_clinical import assess_wellbeing_turn
from foresight_x.slime.wellbeing_router import is_safety_escalation_message


def test_panic_cant_breathe_not_safety_escalation() -> None:
    msg = "I'm still panicking and I can't breathe"
    assert not is_safety_escalation_message(msg)
    a = assess_wellbeing_turn(msg, None, llm=None)
    assert a.recommended_protocol != "safety_escalation"
    assert a.best_counseling_move == "stabilize"
    assert a.response_tempo == "brief_stabilizing"


def test_chest_pain_cant_breathe_is_safety_escalation() -> None:
    msg = "I have chest pain and I can't breathe"
    assert is_safety_escalation_message(msg)
    a = assess_wellbeing_turn(msg, None, llm=None)
    assert a.recommended_protocol == "safety_escalation"


def test_listen_overrides_boundary_counseling_move() -> None:
    a = assess_wellbeing_turn(
        "My friend betrayed me. Just listen, no advice.",
        None,
        llm=None,
    )
    assert a.protocol_fit == "none"
    assert a.best_counseling_move in ("meaning_reflection", "accurate_empathy")
    assert a.recommended_protocol == "supportive_reflection"


def test_grief_friend_not_interpersonal_protocol() -> None:
    a = assess_wellbeing_turn(
        "My friend died last week and I miss them so much",
        None,
        llm=None,
    )
    assert a.recommended_protocol == "supportive_reflection"
    assert a.best_counseling_move == "meaning_reflection"
    assert a.primary_process == "grief_meaning"
    assert a.protocol_fit == "none"


def test_panic_streak_still_stabilizes() -> None:
    thread: dict = {
        "therapy_session": {
            "intake_complete": True,
            "technique_turn_streak": 2,
            "mood_score": 9,
        }
    }
    a = assess_wellbeing_turn("I'm still panicking and I can't breathe", thread, llm=None)
    assert a.recommended_protocol in ("distress_tolerance", "emotion_regulation")
    assert a.best_counseling_move == "stabilize"
    assert not is_safety_escalation_message("I'm still panicking and I can't breathe")


def test_relationship_conflict_still_routes_boundary() -> None:
    a = assess_wellbeing_turn(
        "My partner won't listen when I set a boundary about texting at night.",
        None,
        llm=None,
    )
    assert a.best_counseling_move == "boundary_script"
    assert a.recommended_protocol == "interpersonal_therapy"


def test_chinese_pushback_repair() -> None:
    a = assess_wellbeing_turn("你说的没用，别建议了", None, llm=None)
    assert a.best_counseling_move == "repair_mismatch"
    assert a.protocol_fit == "none"


def test_chinese_listen_preference() -> None:
    thread: dict = {"therapy_session": {}}
    save_wellbeing_intake(
        thread,
        mood_score=5,
        primary_concern="压力",
        session_goal="被理解",
        support_preference="listen",
    )
    a = assess_wellbeing_turn("我只想听你说，不要建议", thread, llm=None)
    assert a.protocol_fit == "none"
    assert a.best_counseling_move in ("meaning_reflection", "accurate_empathy")
