"""Wellbeing clinical routing — counseling-first triage + scoring fallback."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from foresight_x.slime.wellbeing_clinical import (
    WellbeingTurnAssessment,
    apply_balanced_routing,
    assess_wellbeing_turn,
    route_wellbeing_protocol,
)
from foresight_x.slime.wellbeing_clinical import (
    _finalize_assessment_fields,
    _user_turn_signals,
)
from foresight_x.slime.wellbeing_protocols import (
    PROTOCOL_IDS,
    build_protocol_prompt_block,
    build_reply_craft_guide,
    build_rimumu_voice_examples,
    evaluate_rimumu_reply_shape,
    reply_shape_constraints,
)
from foresight_x.slime.therapy_session import save_wellbeing_intake


def test_safety_regex_overrides_llm() -> None:
    r = route_wellbeing_protocol("I want to kill myself", None, llm=MagicMock())
    assert r.safety_escalation
    assert r.protocol == "safety_escalation"


def test_fallback_scoring_distress_only_when_panic() -> None:
    low = assess_wellbeing_turn("I'm a bit stressed about work", None, llm=None)
    assert low.recommended_protocol != "distress_tolerance"
    high = assess_wellbeing_turn("I'm panicking and I can't calm down", None, llm=None)
    assert high.recommended_protocol in ("distress_tolerance", "emotion_regulation")
    assert high.response_tempo == "brief_stabilizing"
    assert high.best_counseling_move == "stabilize"


def test_fallback_respects_listen_preference() -> None:
    thread: dict = {"therapy_session": {}}
    save_wellbeing_intake(
        thread,
        mood_score=4,
        primary_concern="Stress",
        session_goal="Feel calmer",
        support_preference="listen",
    )
    a = assess_wellbeing_turn("I'm worried about tomorrow", thread, llm=None)
    assert a.recommended_protocol == "supportive_reflection"
    assert a.alliance_priority
    assert a.protocol_fit == "none"
    assert a.best_counseling_move in ("meaning_reflection", "accurate_empathy")


def test_listen_signal_blocks_structured_protocol() -> None:
    a = assess_wellbeing_turn(
        "I just need you to listen — don't fix anything, I'm exhausted",
        None,
        llm=None,
    )
    assert a.recommended_protocol == "supportive_reflection"
    assert a.protocol_fit == "none"


def test_shame_routes_to_labeling_not_worksheet() -> None:
    a = assess_wellbeing_turn(
        "I hate myself for messing up again. I'm so pathetic.",
        None,
        llm=None,
    )
    assert a.best_counseling_move in ("emotion_labeling", "meaning_reflection", "gentle_challenge")
    assert a.recommended_protocol != "cbt_thought_record" or a.protocol_fit != "structured"
    assert a.core_affect == "shame"
    assert a.response_tempo == "slow"


def test_pushback_triggers_repair_mismatch() -> None:
    a = assess_wellbeing_turn(
        "That advice didn't work. You're not listening.",
        None,
        llm=None,
    )
    assert a.best_counseling_move == "repair_mismatch"
    assert a.protocol_fit == "none"
    assert a.recommended_protocol == "supportive_reflection"


def test_ambivalence_double_sided_reflection() -> None:
    a = assess_wellbeing_turn(
        "Part of me wants to quit drinking but part of me isn't sure I can.",
        None,
        llm=None,
    )
    assert a.best_counseling_move == "double_sided_reflection"
    assert a.recommended_protocol in ("motivational_interviewing", "supportive_reflection")


def test_relationship_conflict_boundary_script() -> None:
    a = assess_wellbeing_turn(
        "My partner won't listen when I set a boundary about texting at night.",
        None,
        llm=None,
    )
    assert a.best_counseling_move == "boundary_script"
    assert a.recommended_protocol == "interpersonal_therapy"


def test_overload_focus_one_thread() -> None:
    a = assess_wellbeing_turn(
        "Everything is too much at once and I can't think — I don't know where to start.",
        {"therapy_session": {"intake_complete": True, "mood_score": 8}},
        llm=None,
    )
    assert a.best_counseling_move == "focus_one_thread"
    assert a.protocol_fit == "light"


@patch("foresight_x.structured_predict.structured_predict")
def test_llm_triage_used_when_available(mock_sp: MagicMock) -> None:
    mock_sp.return_value = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="avoidance",
        recommended_protocol="behavioral_activation",
        session_phase="intervention",
        alliance_priority=False,
        needs_body_stabilization=False,
        formulation_note="Avoidance loop noted",
        protocol_fit="light",
        best_counseling_move="action_planning",
    )
    llm = MagicMock()
    a = assess_wellbeing_turn("I keep putting off everything", None, llm=llm)
    assert a.recommended_protocol == "behavioral_activation"
    mock_sp.assert_called_once()


def test_llm_downgrades_distress_without_body_need() -> None:
    with patch("foresight_x.structured_predict.structured_predict") as mock_sp:
        mock_sp.return_value = WellbeingTurnAssessment(
            intensity_0_10=5,
            primary_process="general_distress",
            recommended_protocol="distress_tolerance",
            needs_body_stabilization=False,
        )
        a = assess_wellbeing_turn("I feel bad", None, llm=MagicMock())
        assert a.recommended_protocol in ("supportive_reflection", "emotion_regulation")


def test_protocol_fit_none_downgrades_structured_protocol() -> None:
    base = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="rumination",
        recommended_protocol="cbt_thought_record",
        protocol_fit="none",
        best_counseling_move="accurate_empathy",
    )
    out = apply_balanced_routing(base, "I'm worried", None)
    assert out.recommended_protocol == "supportive_reflection"


def test_all_protocol_ids_in_catalog() -> None:
    from foresight_x.slime.wellbeing_protocols import PROTOCOL_CATALOG

    catalog_ids = {x["id"] for x in PROTOCOL_CATALOG}
    for pid in PROTOCOL_IDS:
        if pid == "relationship_script":
            continue
        assert pid in catalog_ids or pid == "safety_escalation"


def test_balanced_streak_forces_listening() -> None:
    thread: dict = {
        "therapy_session": {
            "intake_complete": True,
            "technique_turn_streak": 2,
            "support_preference": "structured",
        }
    }
    a = assess_wellbeing_turn("I keep avoiding everything", thread, llm=None)
    assert a.recommended_protocol == "supportive_reflection"
    assert a.alliance_priority
    assert a.protocol_fit == "none"
    assert a.best_counseling_move in ("meaning_reflection", "repair_mismatch")


def test_balanced_wants_skill_unlocks_module() -> None:
    thread: dict = {
        "therapy_session": {
            "intake_complete": True,
            "mood_score": 6,
            "support_preference": "listen",
        }
    }
    a = assess_wellbeing_turn(
        "I can't stop overthinking — what can I do right now?",
        thread,
        llm=None,
    )
    assert a.recommended_protocol in ("cbt_thought_record", "act", "supportive_reflection")


def test_build_protocol_prompt_includes_counseling_formulation() -> None:
    assessment = WellbeingTurnAssessment(
        intensity_0_10=6,
        primary_process="self_criticism",
        recommended_protocol="supportive_reflection",
        core_affect="shame",
        underlying_need="permission",
        best_counseling_move="emotion_labeling",
        protocol_fit="none",
        why_this_move="Shame present — soften before skills",
    )
    block = build_protocol_prompt_block("supportive_reflection", assessment=assessment)
    assert "emotion_labeling" in block
    assert "Protocol fit: NONE" in block
    assert "shame" in block.lower()


def test_build_protocol_prompt_includes_act() -> None:
    block = build_protocol_prompt_block("act")
    assert "Acceptance" in block or "ACT" in block
    assert "worksheet" in block.lower() or "Do not" in block


def test_protocol_fit_none_forces_alliance_and_downgrades_move() -> None:
    base = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="rumination",
        recommended_protocol="cbt_thought_record",
        protocol_fit="none",
        best_counseling_move="action_planning",
        alliance_priority=False,
        session_phase="intervention",
    )
    out = apply_balanced_routing(base, "I'm worried", None)
    assert out.recommended_protocol == "supportive_reflection"
    assert out.alliance_priority is True
    assert out.session_phase == "rapport"
    assert out.best_counseling_move in (
        "accurate_empathy",
        "meaning_reflection",
        "clarifying_question",
        "emotion_labeling",
    )


def test_finalize_protocol_fit_none_alliance_explicit() -> None:
    data = {
        "recommended_protocol": "cbt_thought_record",
        "protocol_fit": "none",
        "best_counseling_move": "collaborative_skill",
        "alliance_priority": False,
        "session_phase": "intervention",
        "response_tempo": "steady",
        "needs_body_stabilization": False,
    }
    _finalize_assessment_fields(
        data,
        user_message="I hate myself",
        signals=_user_turn_signals("I hate myself"),
    )
    assert data["recommended_protocol"] == "supportive_reflection"
    assert data["alliance_priority"] is True
    assert data["best_counseling_move"] == "emotion_labeling"


def test_ambivalence_routing_not_eaten_by_initial_move() -> None:
    """apply_balanced_routing must override pre-filled move from assessment."""
    base = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="ambivalence",
        recommended_protocol="supportive_reflection",
        protocol_fit="none",
        best_counseling_move="accurate_empathy",
    )
    out = apply_balanced_routing(
        base,
        "Part of me wants to leave but part of me feels cruel.",
        None,
    )
    assert out.best_counseling_move == "double_sided_reflection"
    assert out.recommended_protocol == "motivational_interviewing"
    assert out.protocol_fit == "light"


def test_relationship_routing_not_eaten_by_initial_move() -> None:
    base = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="interpersonal",
        recommended_protocol="supportive_reflection",
        protocol_fit="none",
        best_counseling_move="accurate_empathy",
    )
    out = apply_balanced_routing(
        base,
        "My partner won't listen when I set a boundary about texting.",
        None,
    )
    assert out.best_counseling_move == "boundary_script"
    assert out.recommended_protocol == "interpersonal_therapy"
    assert out.protocol_fit == "light"


def test_cbt_prompt_protocol_fit_none_uses_supportive_body() -> None:
    assessment = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="rumination",
        recommended_protocol="cbt_thought_record",
        protocol_fit="none",
        best_counseling_move="accurate_empathy",
    )
    block = build_protocol_prompt_block("cbt_thought_record", assessment=assessment)
    assert "Protocol fit: NONE" in block
    assert "do not output worksheet" in block.lower() or "No worksheet" in block
    assert "thought record" not in block.lower() or "do not" in block.lower()


def test_protocol_fit_light_micro_intervention() -> None:
    assessment = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="avoidance",
        recommended_protocol="act",
        protocol_fit="light",
        best_counseling_move="collaborative_skill",
    )
    block = build_protocol_prompt_block("act", assessment=assessment)
    assert "micro-intervention" in block.lower() or "ONE natural" in block


def test_protocol_fit_structured_one_step() -> None:
    assessment = WellbeingTurnAssessment(
        intensity_0_10=6,
        primary_process="rumination",
        recommended_protocol="cbt_thought_record",
        protocol_fit="structured",
        best_counseling_move="collaborative_skill",
    )
    block = build_protocol_prompt_block("cbt_thought_record", assessment=assessment)
    assert "ONE step" in block or "one step" in block.lower()


def test_reply_craft_guide_move_specific() -> None:
    for move, needle in (
        ("emotion_labeling", "shame"),
        ("repair_mismatch", "exercise"),
        ("stabilize", "body"),
    ):
        guide = build_reply_craft_guide(
            WellbeingTurnAssessment(
                intensity_0_10=5,
                primary_process="general_distress",
                recommended_protocol="supportive_reflection",
                best_counseling_move=move,
                response_tempo="brief_stabilizing" if move == "stabilize" else "steady",
                protocol_fit="none",
            )
        )
        assert needle in guide.lower()


def test_voice_examples_in_prompt_not_copy_verbatim() -> None:
    block = build_protocol_prompt_block("supportive_reflection")
    examples = build_rimumu_voice_examples()
    assert "do NOT copy" in examples or "do not copy" in examples.lower()
    assert "Rimumu voice examples" in block
    assert "do not copy" in block.lower()


def test_reply_shape_constraints_serialized() -> None:
    shape = reply_shape_constraints(
        WellbeingTurnAssessment(
            intensity_0_10=5,
            primary_process="general_distress",
            recommended_protocol="supportive_reflection",
            protocol_fit="none",
        )
    )
    assert shape["max_questions"] == 1
    assert shape["allow_numbered_steps"] is False
    block = build_protocol_prompt_block(
        "supportive_reflection",
        assessment=WellbeingTurnAssessment(
            intensity_0_10=5,
            primary_process="general_distress",
            recommended_protocol="supportive_reflection",
            protocol_fit="none",
        ),
    )
    assert "max_questions" in block


def test_evaluate_reply_shape_flags() -> None:
    a = WellbeingTurnAssessment(
        intensity_0_10=5,
        primary_process="general_distress",
        recommended_protocol="supportive_reflection",
        protocol_fit="none",
        best_counseling_move="repair_mismatch",
    )
    issues = evaluate_rimumu_reply_shape(
        "Try this exercise: step 1 write thoughts, step 2 challenge them.",
        a,
    )
    assert "numbered_steps_when_protocol_fit_none" in issues
    assert "exercise_after_repair_move" in issues
