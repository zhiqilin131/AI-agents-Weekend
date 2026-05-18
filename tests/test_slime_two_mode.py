"""Two-Slime architecture: identity, routing, personalization removal."""

from __future__ import annotations

from foresight_x.slime.identity import get_slime_identity, theme_palette_for_type
from foresight_x.shadow.chat import (
    ShadowChatTurn,
    SlimeBuddyChatTurn,
    WellbeingBuddyChatTurn,
    _structured_turn_schema,
)
from foresight_x.slime.prompts import (
    build_generalized_turn_addendum,
    build_wellbeing_turn_addendum,
    wellbeing_slime_instructions,
)
from foresight_x.slime.wellbeing_protocols import build_protocol_prompt_block
from foresight_x.slime.turn_params import build_slime_turn_kwargs
from foresight_x.slime.wellbeing_router import route_wellbeing_protocol
from foresight_x.config import Settings
import pytest
from foresight_x.voice.slime_tools import _reject_slime_personalization_patch


def test_generalized_slime_classic_blue_palette() -> None:
    pal = theme_palette_for_type("generalized")
    assert pal["a"] == "#2563EB"
    assert pal["b"] == "#4F8FF7"


def test_wellbeing_slime_soft_rose_palette() -> None:
    pal = theme_palette_for_type("wellbeing")
    assert pal["a"] == "#E8A0B0"
    assert pal["b"] == "#F5D0D8"


def test_generalized_prompt_profile_in_addendum() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    text = build_generalized_turn_addendum(settings)
    assert "Mochi" in text
    assert "everyday decision companion" in text.lower()


def test_wellbeing_prompt_profile_in_addendum() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    addendum, route = build_wellbeing_turn_addendum(settings, user_message="I feel stressed")
    assert "Rimumu" in addendum
    assert "not a therapist" in addendum.lower()
    assert "persona_backstory" not in addendum  # lore is prose, not field name
    assert "rose-hued" in addendum.lower() or "rose" in addendum.lower()
    assert route.protocol in (
        "supportive_reflection",
        "distress_tolerance",
        "problem_management",
    )


def test_wellbeing_shadow_turn_schema_not_inner_shadow() -> None:
    assert _structured_turn_schema("shadow", "wellbeing") is ShadowChatTurn
    assert _structured_turn_schema("slime_buddy", "wellbeing") is WellbeingBuddyChatTurn
    assert _structured_turn_schema("slime_buddy", "generalized") is SlimeBuddyChatTurn
    desc = WellbeingBuddyChatTurn.model_fields["reply_to_user"].description or ""
    assert "inner shadow" not in desc.lower()
    assert "parrot" in desc.lower() or "echo" in desc.lower()


def test_wellbeing_prompt_forbids_user_echo() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    addendum, _ = build_wellbeing_turn_addendum(settings, user_message="I feel pathetic about my life")
    low = addendum.lower()
    assert "not the user" in low
    assert "second person" in low or "you/your" in low
    assert "verbatim echo" in low or "parrot" in low

    instr = wellbeing_slime_instructions().lower()
    assert "not the user" in instr
    assert "verbatim echo" in instr or "parrot" in instr

    protocol = build_protocol_prompt_block("supportive_reflection").lower()
    assert "second person" in protocol or "you/your" in protocol
    assert "echo" in protocol or "parrot" in protocol


def test_thread_generalized_uses_generalized_kwargs() -> None:
    settings = Settings(foresight_user_id="u", openai_api_key="")
    kw = build_slime_turn_kwargs(
        settings,
        {"slime_type": "generalized"},
        intent_probe="hello",
        chat_intent_label="general_chat",
    )
    assert kw.get("synthesis_frame") == "slime_buddy"
    assert kw.get("slime_type") == "generalized"
    assert "Mochi" in (kw.get("slime_voice_style_addendum") or "")


def test_personalization_patch_rejected() -> None:
    msg = _reject_slime_personalization_patch({"color_theme": "mint"})
    assert msg is not None
    msg2 = _reject_slime_personalization_patch({"persona": {"tone": "playful"}})
    assert msg2 is not None
    assert _reject_slime_personalization_patch({"name": "Mochi"}) is not None


@pytest.mark.parametrize(
    ("message", "expected_protocol"),
    [
        ("I want to hurt myself", "safety_escalation"),
        ("I'm panicking and I can't calm down", "distress_tolerance"),
        ("My whole career is over because I failed one thing", "cbt_thought_record"),
        ("I can't get out of bed and I keep avoiding work", "behavioral_activation"),
        (
            "I know drinking helps me sleep but I'm worried it's becoming a problem",
            "motivational_interviewing",
        ),
        ("Help me text my girlfriend without sounding needy or angry", "interpersonal_therapy"),
    ],
)
def test_wellbeing_protocol_routing_fallback(message: str, expected_protocol: str) -> None:
    """Scoring fallback when no LLM (CI-safe)."""
    r = route_wellbeing_protocol(message, llm=None)
    assert r.protocol == expected_protocol


def test_generalized_identity_mochi_name() -> None:
    ident = get_slime_identity("generalized")
    assert ident.short_name == "Mochi"
    assert ident.ui_spoken_name == "Mochi"


def test_wellbeing_identity_rimumu_name() -> None:
    ident = get_slime_identity("wellbeing")
    assert ident.short_name == "Rimumu"
    assert ident.ui_spoken_name == "Rimumu"
    assert ident.tts_voice == "shimmer"
    assert len(ident.persona_backstory) > 40
    assert "rose" in ident.persona_backstory.lower()


def test_wellbeing_thread_self_reply_uses_rimumu(monkeypatch, tmp_path) -> None:
    from foresight_x.chat.conversation_service import ensure_slime_voice_thread, process_conversation_turn
    from unittest.mock import patch

    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_rimumu"
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / f"{uid}.json").write_text(
        '{"user_id":"u_rimumu","memory_facts":[],"priority_lines":[],"about_me":"","slime_profile":{"name":"Peyton Pritchard","color_theme":"violet","personality":"calm"}}',
        encoding="utf-8",
    )
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    thread = ensure_slime_voice_thread(uid, None, slime_type="wellbeing")
    with patch("foresight_x.chat.conversation_service.run_shadow_turn") as rs:
        with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
            out = process_conversation_turn(
                settings=settings,
                user_id=uid,
                thread=thread,
                user_message="Who are you?",
                source="slime_voice",
                modality="voice",
            )
    rs.assert_not_called()
    assert "Rimumu" in out["assistant_text"]
    assert "Peyton" not in out["assistant_text"]
    assert "You are Rimumu" not in out["assistant_text"]
    assert "I'm Rimumu" in out["assistant_text"]


def test_generalized_tts_voice_male() -> None:
    ident = get_slime_identity("generalized")
    assert ident.tts_voice == "onyx"
