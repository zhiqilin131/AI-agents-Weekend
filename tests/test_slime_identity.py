"""Slime Buddy identity: saved name, profile store, voice + chat short-circuit."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from foresight_x.chat.conversation_service import ensure_slime_voice_thread, process_conversation_turn
from foresight_x.config import Settings
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import (
    SlimeAccessory,
    SlimeColorTheme,
    SlimePersona,
    SlimePersonaTone,
    SlimeProfile,
    SlimeShape,
    UserProfile,
)
from foresight_x.voice.slime_voice_synthesis import apply_voice_persona_template
from foresight_x.ui.api_server import _run_slime_voice_pipeline
from foresight_x.voice.asr import TranscriptionResult
from foresight_x.voice.slime_identity import (
    EffectiveSlimePersona,
    format_slime_identity_reply,
    get_effective_slime_persona,
    is_slime_identity_question,
)


def test_is_slime_identity_question_english() -> None:
    assert is_slime_identity_question("Hi, what is your name?")
    assert is_slime_identity_question("who are you")
    assert is_slime_identity_question("What should I call you?")


def test_is_slime_identity_question_chinese() -> None:
    assert is_slime_identity_question("你叫什么名字")
    assert is_slime_identity_question("你是谁")


def test_not_identity_when_user_names_self() -> None:
    assert not is_slime_identity_question("My name is Alex.")
    assert not is_slime_identity_question("What is my name?")


def test_effective_persona_reads_saved_slime_name(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_eff"
    prof = UserProfile(
        user_id=uid,
        slime_profile=SlimeProfile(
            name="SirBlob",
            color_theme=SlimeColorTheme.VIOLET,
            shape=SlimeShape.CLASSIC,
            accessory=SlimeAccessory.NONE,
            updated_at="",
        ),
    )
    save_user_profile(prof, settings=Settings(foresight_user_id=uid, foresight_data_dir=tmp_path))
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    eff = get_effective_slime_persona(settings)
    assert eff.name == "SirBlob"
    assert eff.profile_saved is True


def test_effective_persona_when_slime_profile_none(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_non"
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / f"{uid}.json").write_text(
        json.dumps({"user_id": uid, "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    eff = get_effective_slime_persona(settings)
    assert eff.profile_saved is False
    txt = format_slime_identity_reply(eff)
    assert "don’t have" in txt.lower() or "don't have" in txt.lower() or "do not have" in txt.lower()


def test_conversation_turn_identity_contains_saved_name(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_conv_id"
    prof = UserProfile(
        user_id=uid,
        slime_profile=SlimeProfile(
            name="Zephyr",
            color_theme=SlimeColorTheme.MINT,
            shape=SlimeShape.ORB,
            accessory=SlimeAccessory.NONE,
            updated_at="",
        ),
    )
    save_user_profile(prof, settings=Settings(foresight_user_id=uid, foresight_data_dir=tmp_path))
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    thread = ensure_slime_voice_thread(uid, None)
    with patch("foresight_x.chat.conversation_service.run_shadow_turn") as rs:
        with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
            out = process_conversation_turn(
                settings=settings,
                user_id=uid,
                thread=thread,
                user_message="Hey — what is your name?",
                source="slime_voice",
                modality="voice",
            )
    rs.assert_not_called()
    assert "Zephyr" in out["assistant_text"]
    assert out["intent"] == "slime_self_question"


def test_voice_pipeline_identity_skips_router(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    uid = "u_vc_id"
    prof = UserProfile(
        user_id=uid,
        slime_profile=SlimeProfile(
            name="Nova",
            color_theme=SlimeColorTheme.AURORA,
            shape=SlimeShape.CLASSIC,
            accessory=SlimeAccessory.NONE,
            updated_at="",
        ),
    )
    save_user_profile(prof, settings=Settings(foresight_user_id=uid, foresight_data_dir=tmp_path))
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )
    tr = TranscriptionResult(
        text="What is your name?",
        provider="faster_whisper",
        language="en",
        timing={},
    )
    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command") as route:
            body = _run_slime_voice_pipeline(
                b"audio",
                "x.webm",
                None,
                None,
                None,
                None,
                settings,
            )
    route.assert_not_called()
    assert "Nova" in body["assistant_text"]
    assert body["tool_call"]["name"] == "slime_self_question"


def test_what_do_you_call_me_voice_pipeline(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    uid = "u_nick_q"
    persona = SlimePersona(user_nickname="My master", tone=SlimePersonaTone.PLAYFUL, warmth=3, humor=2)
    prof = UserProfile(
        user_id=uid,
        slime_profile=SlimeProfile(
            name="Blob",
            color_theme=SlimeColorTheme.VIOLET,
            shape=SlimeShape.CLASSIC,
            accessory=SlimeAccessory.NONE,
            persona=persona,
            updated_at="",
        ),
    )
    save_user_profile(prof, settings=Settings(foresight_user_id=uid, foresight_data_dir=tmp_path))
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )
    tr = TranscriptionResult(text="What do you call me?", provider="fw", language="en", timing={})
    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command") as route:
            body = _run_slime_voice_pipeline(
                b"a",
                "x.webm",
                None,
                None,
                None,
                None,
                settings,
            )
    route.assert_not_called()
    assert "My master" in body["assistant_text"]


def test_apply_voice_template_playful_navigate() -> None:
    p = SlimePersona(
        user_nickname="My master",
        tone=SlimePersonaTone.PLAYFUL,
        warmth=3,
        humor=2,
        directness=1,
        reply_length="short",
    )
    eff = EffectiveSlimePersona(
        name="Mochi",
        persona=p,
        user_nickname_for_address="My master",
        profile_saved=True,
    )
    out = apply_voice_persona_template("Opening execution_calendar.", tool_name="navigate", eff=eff)
    assert "My master" in out
    assert "opening" in out.lower()


def test_save_name_reload_effective(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_save"
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / f"{uid}.json").write_text(
        json.dumps({"user_id": uid, "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    loaded = load_user_profile(settings)
    merged = SlimeProfile(
        name="MochiTwo",
        color_theme=SlimeColorTheme.VIOLET,
        shape=SlimeShape.CLASSIC,
        accessory=SlimeAccessory.NONE,
        updated_at="t",
    )
    save_user_profile(loaded.model_copy(update={"slime_profile": merged}), settings=settings)
    eff = get_effective_slime_persona(settings)
    assert eff.name == "MochiTwo"
