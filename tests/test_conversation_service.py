"""Shared conversation_service used by Slime Buddy (Shadow-parity turns)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from foresight_x.chat.conversation_service import ensure_slime_voice_thread, process_conversation_turn
from foresight_x.config import Settings


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
    fake_out.used_memory_facts = False
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
    assert len(out["spoken_sequence"]) >= 1


def test_slime_voice_thread_tagged(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    t = ensure_slime_voice_thread("u_tag", None)
    assert t.get("source") == "slime_voice"
    assert t.get("thread_id")
