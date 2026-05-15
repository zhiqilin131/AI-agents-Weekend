"""Shared conversation_service used by Slime Buddy (Shadow-parity turns)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from foresight_x.chat.conversation_service import ensure_slime_voice_thread, process_conversation_turn
from foresight_x.config import Settings
from foresight_x.profile.proactive_memory import ProactiveMemoryCaptureResult
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact


def _minimal_profile(path: Path, uid: str) -> None:
    (path / "profile").mkdir(parents=True, exist_ok=True)
    (path / "profile" / f"{uid}.json").write_text(
        json.dumps(
            {
                "user_id": uid,
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
            }
        ),
        encoding="utf-8",
    )


def test_slime_voice_turn_decision_envelope(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_conv"
    _minimal_profile(tmp_path, uid)
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )

    class _I:
        intent = "decision_candidate"

    fake_out = MagicMock()
    fake_out.reply = "That sounds like a real fork in the road — we can structure it."
    fake_out.used_memory_facts = []
    fake_out.profile_record_texts = []
    fake_out.thread_only_items = []

    thread = ensure_slime_voice_thread(uid, None)
    with patch("foresight_x.chat.conversation_service.detect_chat_intent", return_value=_I()):
        with patch("foresight_x.chat.conversation_service.run_shadow_turn", return_value=fake_out):
            with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
                out = process_conversation_turn(
                    settings=settings,
                    user_id=uid,
                    thread=thread,
                    user_message="Should I take this offer?",
                    source="slime_voice",
                    modality="voice",
                )

    assert out["assistant_text"]
    assert out["decision_suggestion"] is not None
    assert out["decision_suggestion"]["should_show"] is True
    assert "Decision" in (out["decision_suggestion"].get("display_text") or "")
    assert out["frontend_action"]["type"] == "show_decision_mode_confirmation"
    assert out["spoken_sequence"] == [out["assistant_text"]]


def test_slime_voice_activate_decision_mode_with_move_phrase(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_conv_decision_move"
    _minimal_profile(tmp_path, uid)
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )

    class _I:
        intent = "decision_candidate"

    fake_out = MagicMock()
    fake_out.reply = "Moving apartments is a big fork — I can structure it in Decision Mode."
    fake_out.used_memory_facts = []
    fake_out.retrieved_memory_facts = []
    fake_out.profile_record_texts = []
    fake_out.profile_memory_events = []
    fake_out.thread_only_items = []
    fake_out.memory_confirmation_question = None

    msg = "Activate decision mode. Shall I move to the new apartment or stay where I am?"
    thread = ensure_slime_voice_thread(uid, None)
    with patch("foresight_x.chat.conversation_service.detect_chat_intent", return_value=_I()):
        with patch("foresight_x.chat.conversation_service.run_shadow_turn", return_value=fake_out):
            with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
                out = process_conversation_turn(
                    settings=settings,
                    user_id=uid,
                    thread=thread,
                    user_message=msg,
                    source="slime_voice",
                    modality="voice",
                )

    assert out["decision_suggestion"] is not None
    assert out["decision_suggestion"]["should_show"] is True
    assert msg in (out["decision_suggestion"].get("decision_prompt") or "")


def test_slime_voice_turn_surfaces_used_memory_evidence(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_conv_memory_evidence"
    _minimal_profile(tmp_path, uid)
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )

    class _I:
        intent = "general_chat"

    fake_out = MagicMock()
    fake_out.reply = "Rose is your girlfriend, and you two have talked about October visits."
    fake_out.used_memory_facts = ["Rose is my girlfriend and we plan October visits."]
    fake_out.retrieved_memory_facts = []
    fake_out.profile_record_texts = []
    fake_out.profile_memory_events = []
    fake_out.thread_only_items = []
    fake_out.memory_confirmation_question = None

    thread = ensure_slime_voice_thread(uid, None)
    with patch("foresight_x.chat.conversation_service.detect_chat_intent", return_value=_I()):
        with patch("foresight_x.chat.conversation_service.run_shadow_turn", return_value=fake_out):
            with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
                out = process_conversation_turn(
                    settings=settings,
                    user_id=uid,
                    thread=thread,
                    user_message="Who is my girlfriend?",
                    source="slime_voice",
                    modality="voice",
                )

    assert out["evidence_items"]
    assert out["evidence_items"][0]["label"] == "Used memory"
    assert "Rose" in out["evidence_items"][0]["fullText"]
    assert out["evidence_items"][0]["confidence"] == 0.64


def test_slime_voice_turn_surfaces_retrieved_profile_evidence(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_conv_retrieved_evidence"
    _minimal_profile(tmp_path, uid)
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )

    class _I:
        intent = "general_chat"

    fact = ProfileMemoryFact(
        id="mf_rose",
        text="Rose is my girlfriend and we plan October visits.",
        category=MemoryFactCategory.IDENTITY,
    )
    fake_out = MagicMock()
    fake_out.reply = "Rose is your girlfriend."
    fake_out.used_memory_facts = []
    fake_out.retrieved_memory_facts = [fact]
    fake_out.profile_record_texts = []
    fake_out.profile_memory_events = []
    fake_out.thread_only_items = []
    fake_out.memory_confirmation_question = None

    thread = ensure_slime_voice_thread(uid, None)
    with patch("foresight_x.chat.conversation_service.detect_chat_intent", return_value=_I()):
        with patch("foresight_x.chat.conversation_service.run_shadow_turn", return_value=fake_out):
            with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
                out = process_conversation_turn(
                    settings=settings,
                    user_id=uid,
                    thread=thread,
                    user_message="Who is my girlfriend?",
                    source="slime_voice",
                    modality="voice",
                )

    assert out["evidence_items"]
    assert out["evidence_items"][0]["type"] == "profile"
    assert "Rose" in (out["evidence_items"][0].get("fullText") or "")


def test_slime_voice_thread_tagged(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    t = ensure_slime_voice_thread("u_tag", None)
    assert t.get("source") == "slime_voice"
    assert t.get("thread_id")


def test_slime_voice_turn_uses_proactive_fallback_when_shadow_emits_no_memory(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    uid = "u_conv_fallback"
    _minimal_profile(tmp_path, uid)
    settings = Settings(
        foresight_user_id=uid,
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )

    class _I:
        intent = "general_chat"

    fake_out = MagicMock()
    fake_out.reply = "Noted."
    fake_out.used_memory_facts = []
    fake_out.profile_record_texts = []
    fake_out.profile_memory_events = []
    fake_out.thread_only_items = []
    fake_out.memory_confirmation_question = None

    thread = ensure_slime_voice_thread(uid, None)
    with patch("foresight_x.chat.conversation_service.detect_chat_intent", return_value=_I()):
        with patch("foresight_x.chat.conversation_service.run_shadow_turn", return_value=fake_out):
            with patch("foresight_x.chat.conversation_service.maybe_update_thread_summary"):
                with patch(
                    "foresight_x.profile.proactive_memory.capture_turn_memory",
                    return_value=ProactiveMemoryCaptureResult(
                        events=[
                            {
                                "action": "new",
                                "id": "mf_1",
                                "text": "User prefers concise answers.",
                                "category": "views",
                            }
                        ],
                        saved_texts=["User prefers concise answers."],
                    ),
                ):
                    out = process_conversation_turn(
                        settings=settings,
                        user_id=uid,
                        thread=thread,
                        user_message="Please keep replies concise.",
                        source="slime_voice",
                        modality="voice",
                    )

    assert out["memory_updates"] == ["User prefers concise answers."]
    assert out["memory_update_details"]
