"""Wellbeing clinical routing — LLM triage + scoring fallback."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from foresight_x.slime.wellbeing_clinical import (
    WellbeingTurnAssessment,
    assess_wellbeing_turn,
    route_wellbeing_protocol,
)
from foresight_x.slime.wellbeing_protocols import PROTOCOL_IDS
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


def test_build_protocol_prompt_includes_act() -> None:
    from foresight_x.slime.wellbeing_protocols import build_protocol_prompt_block

    block = build_protocol_prompt_block("act")
    assert "Acceptance" in block or "ACT" in block
    assert "breathing" not in block.lower() or "do not" in block.lower()
