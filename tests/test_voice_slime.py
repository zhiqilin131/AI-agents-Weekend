"""Tests for Slime voice ASR dispatch, tools, and voice-command endpoint (mocked)."""

from __future__ import annotations

import io
import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from foresight_x.config import Settings
from foresight_x.ui.api_server import _run_slime_voice_pipeline
from foresight_x.voice.asr import TranscriptionResult, transcribe_audio
from foresight_x.voice.slime_tools import execute_slime_tool, tool_navigate
from foresight_x.voice.slime_voice_router import SlimeVoiceContext, SlimeVoiceRouteResult


def test_asr_dispatch_faster_whisper(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "faster_whisper")
    audio = tmp_path / "x.webm"
    audio.write_bytes(b"x")
    fake = TranscriptionResult(text="hello", provider="faster_whisper", language="en", timing={})
    with patch("foresight_x.voice.asr.transcribe_with_faster_whisper", return_value=fake) as m:
        r = transcribe_audio(audio)
    assert r.text == "hello"
    m.assert_called_once()


def test_asr_dispatch_openai(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "openai")
    audio = tmp_path / "x.wav"
    audio.write_bytes(b"x")
    fake = TranscriptionResult(text="hey", provider="openai", language=None, timing={})
    with patch("foresight_x.voice.asr.transcribe_with_openai", return_value=fake) as m:
        r = transcribe_audio(audio)
    assert r.provider == "openai"
    m.assert_called_once()


def test_asr_unsupported_provider(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "not_a_provider")
    with pytest.raises(ValueError, match="Unsupported ASR_PROVIDER"):
        transcribe_audio(tmp_path / "a.webm")


def test_faster_whisper_model_cached(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "faster_whisper")
    from foresight_x.voice import asr

    asr._model_cache.clear()
    asr._model_load_ms.clear()

    mock_model = MagicMock()

    class _Seg:
        text = "hi"

    def _transcribe(*_a, **_k):
        return iter([_Seg()]), MagicMock(duration=1.2, language="en")

    mock_model.transcribe.side_effect = _transcribe
    audio = tmp_path / "rec.webm"
    audio.write_bytes(b"0")

    ctor = MagicMock(return_value=mock_model)
    fake_fw = types.ModuleType("faster_whisper")
    fake_fw.WhisperModel = ctor
    sys.modules["faster_whisper"] = fake_fw
    try:
        asr.transcribe_with_faster_whisper(audio)
        asr.transcribe_with_faster_whisper(audio)
    finally:
        sys.modules.pop("faster_whisper", None)
        asr._model_cache.clear()
        asr._model_load_ms.clear()
    assert ctor.call_count == 1


def test_voice_pipeline_deletes_temp_file(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings = Settings(
        foresight_user_id="u_voice",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice.json").write_text(
        json.dumps({"user_id": "u_voice", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )

    tr = TranscriptionResult(text="navigate", provider="faster_whisper", language="en", timing={})
    route = SlimeVoiceRouteResult(
        intent="navigate",
        tool_name="navigate",
        arguments={"route": "home"},
        requires_confirmation=False,
    )

    created: list[Path] = []

    real_mkstemp = __import__("tempfile").mkstemp

    def wrapped_mkstemp(*args, **kwargs):
        fd, path = real_mkstemp(*args, **kwargs)
        created.append(Path(path))
        return fd, path

    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command", return_value=route):
            with patch("tempfile.mkstemp", side_effect=wrapped_mkstemp):
                _run_slime_voice_pipeline(
                    b"bytes",
                    "a.webm",
                    "/buddy",
                    None,
                    None,
                    None,
                    settings,
                )
    assert len(created) == 1
    assert not created[0].exists()


def test_voice_command_http_mocked(monkeypatch) -> None:
    import foresight_x.ui.api_server as api_server

    def fake_pipeline(*_a, **_k):
        return {
            "transcript": "t",
            "asr_provider": "faster_whisper",
            "language": "en",
            "assistant_text": "ok",
            "intent": "unknown",
            "tool_call": {"name": "no_op", "arguments": {}},
            "tool_result": {},
            "frontend_action": {"type": "none", "route": "", "payload": {}},
            "requires_confirmation": False,
            "timing": {},
            "voice_ui": {"intent": "unknown", "memory_phases": [], "evidence_items": [], "should_show_evidence_drawer": False},
        }

    monkeypatch.setenv("FORESIGHT_USER_ID", "demo_user")
    with patch.object(api_server, "_run_slime_voice_pipeline", side_effect=fake_pipeline):
        client = TestClient(api_server.app)
        files = {"audio": ("v.webm", io.BytesIO(b"abc"), "audio/webm")}
        r = client.post("/api/slime/voice-command", files=files)
    assert r.status_code == 200
    body = r.json()
    assert body["transcript"] == "t"
    assert body["asr_provider"] == "faster_whisper"


def test_slime_tts_requires_openai_key(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "")
    from foresight_x.ui import api_server

    c = TestClient(api_server.app)
    r = c.post("/api/slime/tts", json={"text": "Hello"})
    assert r.status_code == 503


def test_navigate_tool_validates_route() -> None:
    tr, fe = tool_navigate({"route": "execution_calendar"})
    assert tr["ok"] is True
    assert fe["route"] == "/execution"
    tr_bad, fe_bad = tool_navigate({"route": "https://evil.test"})
    assert tr_bad["ok"] is False
    assert fe_bad["type"] == "none"


def test_navigate_diary_journal_profile_aliases() -> None:
    d, fe_d = tool_navigate({"route": "diary"})
    assert d["ok"] and fe_d["route"] == "/diary"
    j, fe_j = tool_navigate({"route": "journal"})
    assert j["ok"] and fe_j["route"] == "/diary"
    up, fe_up = tool_navigate({"route": "user_profile"})
    assert up["ok"] and fe_up["route"] == "/profile"
    chat, fe_c = tool_navigate({"route": "chat"})
    assert chat["ok"] and fe_c["route"] == "/chat"
    norm, fe_n = tool_navigate({"route": "shadow-chat"})
    assert norm["ok"] and fe_n["route"] == "/chat"


def test_memory_search_no_invention(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u1",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u1.json").write_text(
        json.dumps(
            {
                "user_id": "u1",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u1")
    route = SlimeVoiceRouteResult(
        intent="memory_search",
        tool_name="search_memory",
        arguments={"query": "Edinburgh castles tour", "scope": "all"},
        requires_confirmation=False,
    )
    _tr, _fe, assistant = execute_slime_tool(route, ctx, settings=settings, transcript="x")
    low = assistant.lower().replace("’", "'")
    assert "don't see" in low or "do not see" in low


def test_profile_update_requires_confirmation() -> None:
    settings = Settings(foresight_user_id="demo_user")
    ctx = SlimeVoiceContext(user_id="demo_user")
    route = SlimeVoiceRouteResult(
        intent="profile_update",
        tool_name="update_slime_profile",
        arguments={"patch": {"name": "Mochi2"}},
        requires_confirmation=True,
    )
    _tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="rename")
    assert fe.get("type") == "confirm"


def test_profile_update_voice_only_merges_partial(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_patch",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_patch.json").write_text(
        json.dumps(
            {
                "user_id": "u_voice_patch",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {
                    "name": "Mochi",
                    "color_theme": "violet",
                    "personality": "calm",
                    "voice": {"enabled": True, "rate": 1.0, "pitch": 1.15, "preferred_voice_name": "Alex"},
                },
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_patch")
    route = SlimeVoiceRouteResult(
        intent="profile_update",
        tool_name="update_slime_profile",
        arguments={"patch": {"voice": {"rate": 0.82}}},
        requires_confirmation=False,
    )
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="speak slower")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.voice is not None
    assert abs(loaded.slime_profile.voice.rate - 0.82) < 0.001
    assert abs(loaded.slime_profile.voice.pitch - 1.15) < 0.001
    assert loaded.slime_profile.voice.preferred_voice_name == "Alex"


def test_profile_update_top_level_role_sets_role_identity(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_role_top",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_role_top.json").write_text(
        json.dumps(
            {
                "user_id": "u_role_top",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_role_top")
    route = SlimeVoiceRouteResult(
        intent="profile_update",
        tool_name="update_slime_profile",
        arguments={"patch": {"role": "A cheerful study buddy who keeps explanations short."}},
        requires_confirmation=False,
    )
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="change your role")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert "study buddy" in (loaded.slime_profile.persona.role_identity or "").lower()


def test_profile_update_minor_shape_returns_slime_profile_refresh(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_shape",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_shape.json").write_text(
        json.dumps(
            {
                "user_id": "u_shape",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_shape")
    route = SlimeVoiceRouteResult(
        intent="profile_update",
        tool_name="update_slime_profile",
        arguments={"patch": {"shape": "orb"}},
        requires_confirmation=False,
    )
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="be round")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"


def test_profile_update_user_nickname_uses_persona_patch_requires_confirmation(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_nick",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_nick.json").write_text(
        json.dumps(
            {
                "user_id": "u_nick",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_nick")
    route = SlimeVoiceRouteResult(
        intent="profile_update",
        tool_name="update_slime_profile",
        arguments={"patch": {"persona": {"user_nickname": "boss"}}},
        requires_confirmation=False,
    )
    _tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="call me boss")
    assert fe.get("type") == "confirm"
    pending = fe.get("payload", {}).get("patch", {})
    assert pending.get("persona", {}).get("user_nickname") == "boss"


def test_calendar_draft_is_not_final_event(tmp_path) -> None:
    from foresight_x.config import Settings
    from foresight_x.voice.slime_tools import tool_create_calendar_draft
    from foresight_x.voice.slime_voice_router import SlimeVoiceContext

    settings = Settings(foresight_user_id="demo_user", foresight_data_dir=tmp_path)
    ctx = SlimeVoiceContext(user_id="demo_user", recent_ui_context={})
    tr, fe = tool_create_calendar_draft(
        {"title": "Plan", "duration_minutes": 30, "date_hint": "tomorrow", "description": None},
        transcript="",
        settings=settings,
        user_timezone="UTC",
        context=ctx,
    )
    assert tr.get("requires_confirmation") is True
    assert fe["type"] == "calendar_draft_confirm"
    assert "resolved" in fe["payload"]
    assert tr["resolved"]["start_iso"]
    assert tr["resolved"]["end_iso"]
    assert tr.get("draft_id")
    assert fe["payload"].get("draft_id")


def test_memory_search_returns_evidence_items_not_raw_dump(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u2",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u2.json").write_text(
        json.dumps(
            {
                "user_id": "u2",
                "memory_facts": [{"id": "f1", "text": "Rose is my girlfriend and we visit in October."}],
                "priority_lines": [],
                "about_me": "",
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u2")
    route = SlimeVoiceRouteResult(
        intent="memory_search",
        tool_name="search_memory",
        arguments={"query": "Who is Rose?", "scope": "all"},
        requires_confirmation=False,
    )
    tr, fe, assistant = execute_slime_tool(route, ctx, settings=settings, transcript="Who is Rose?")
    assert fe["payload"].get("display_mode") == "particles"
    assert isinstance(tr.get("evidence_items"), list)
    assert len(tr["evidence_items"]) >= 1
    assert "• From your profile" not in assistant
    assert "From your profile memory:" not in assistant


def test_calendar_parse_saturday_morning() -> None:
    from foresight_x.calendar.datetime_resolver import resolve_calendar_draft
    from foresight_x.voice.calendar_command_parser import CalendarDraft

    d = CalendarDraft(
        title="Planning block",
        duration_minutes=30,
        date_hint="Saturday",
        time_hint="morning",
    )
    now = datetime(2026, 5, 6, 12, 0, tzinfo=timezone.utc)  # Wednesday
    r = resolve_calendar_draft(d, user_timezone="UTC", now=now)
    assert "Saturday" in r.display_summary
    assert r.requires_confirmation is True
