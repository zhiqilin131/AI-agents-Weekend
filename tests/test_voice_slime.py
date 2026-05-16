"""Tests for Slime voice ASR dispatch, tools, and voice-command endpoint (mocked)."""

from __future__ import annotations

import io
import json
import sys
import time
import types
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from foresight_x.config import Settings
from foresight_x.ui.api_server import _run_slime_voice_pipeline
from foresight_x.voice.asr import TranscriptionResult, transcribe_audio
from foresight_x.calendar_agent.schemas import CalendarEvent
from foresight_x.calendar_agent.store import upsert_event
from foresight_x.voice.slime_tools import execute_slime_tool, tool_navigate, tool_search_calendar
from foresight_x.voice.slime_voice_router import SlimeVoiceContext, SlimeVoiceRouteResult, route_slime_voice_command


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


def test_voice_command_http_mocked(monkeypatch, tmp_path: Path) -> None:
    import foresight_x.ui.api_server as api_server

    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FORESIGHT_USER_ID", "demo_user")
    (tmp_path / "personas_registry.json").write_text(
        json.dumps(
            {
                "current_user_id": "demo_user",
                "users": [{"user_id": "demo_user", "created_at": "2026-01-01T00:00:00Z"}],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(api_server, "get_supabase_user_for_request", lambda: None)

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

    with patch.object(api_server, "_run_slime_voice_pipeline", side_effect=fake_pipeline):
        client = TestClient(api_server.app)
        files = {"audio": ("v.webm", io.BytesIO(b"abc"), "audio/webm")}
        r = client.post("/api/slime/voice-command", files=files)
    assert r.status_code == 200
    body = r.json()
    assert body["transcript"] == "t"
    assert body["asr_provider"] == "faster_whisper"


def test_voice_command_stream_http_mocked(monkeypatch, tmp_path: Path) -> None:
    import foresight_x.ui.api_server as api_server

    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FORESIGHT_USER_ID", "demo_user")
    (tmp_path / "personas_registry.json").write_text(
        json.dumps(
            {
                "current_user_id": "demo_user",
                "users": [{"user_id": "demo_user", "created_at": "2026-01-01T00:00:00Z"}],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(api_server, "get_supabase_user_for_request", lambda: None)

    def fake_pipeline(*_a, **_k):
        return {
            "transcript": "stream me",
            "asr_provider": "faster_whisper",
            "language": "en",
            "assistant_text": "Hello. Streaming works.",
            "spoken_text": "Hello. Streaming works.",
            "intent": "general_chat",
            "tool_call": {"name": "no_op", "arguments": {}},
            "tool_result": {},
            "frontend_action": {"type": "none", "route": "", "payload": {}},
            "requires_confirmation": False,
            "timing": {},
            "voice_ui": {"intent": "general_chat", "memory_phases": [], "evidence_items": [], "should_show_evidence_drawer": False},
        }

    with patch.object(api_server, "_run_slime_voice_pipeline", side_effect=fake_pipeline):
        client = TestClient(api_server.app)
        files = {"audio": ("v.webm", io.BytesIO(b"abc"), "audio/webm")}
        r = client.post("/api/slime/voice-command-stream", files=files)
    assert r.status_code == 200
    events: list[dict[str, object]] = []
    for raw_line in r.text.splitlines():
        line = raw_line.strip()
        if not line.startswith("data: "):
            continue
        events.append(json.loads(line[6:]))
    etypes = [str(ev.get("type", "")) for ev in events]
    assert "transcript_ready" in etypes
    assert "text_delta" in etypes
    assert etypes[-1] == "done"
    done = events[-1]
    voice_response = done.get("voice_response")
    assert isinstance(voice_response, dict)
    assert voice_response.get("transcript") == "stream me"


def test_transcribe_rejects_oversized_audio(monkeypatch) -> None:
    import foresight_x.ui.api_server as api_server

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(api_server, "MAX_AUDIO_UPLOAD_BYTES", 3)
    client = TestClient(api_server.app)
    files = {"file": ("v.webm", io.BytesIO(b"abcd"), "audio/webm")}

    r = client.post("/api/transcribe", files=files)

    assert r.status_code == 413
    assert "audio_file_too_large" in r.json()["detail"]


def test_voice_command_rejects_oversized_audio_before_pipeline(monkeypatch) -> None:
    import foresight_x.ui.api_server as api_server

    monkeypatch.setattr(api_server, "MAX_AUDIO_UPLOAD_BYTES", 3)
    client = TestClient(api_server.app)
    files = {"audio": ("v.webm", io.BytesIO(b"abcd"), "audio/webm")}

    with patch.object(api_server, "_run_slime_voice_pipeline", side_effect=AssertionError("pipeline called")):
        r = client.post("/api/slime/voice-command", files=files)

    assert r.status_code == 413
    assert "audio_file_too_large" in r.json()["detail"]


def test_voice_command_stream_rejects_oversized_audio_before_pipeline(monkeypatch) -> None:
    import foresight_x.ui.api_server as api_server

    monkeypatch.setattr(api_server, "MAX_AUDIO_UPLOAD_BYTES", 3)
    client = TestClient(api_server.app)
    files = {"audio": ("v.webm", io.BytesIO(b"abcd"), "audio/webm")}

    with patch.object(api_server, "_run_slime_voice_pipeline", side_effect=AssertionError("pipeline called")):
        r = client.post("/api/slime/voice-command-stream", files=files)

    assert r.status_code == 413
    assert "audio_file_too_large" in r.json()["detail"]


def test_voice_pipeline_conversation_turn_includes_memory_update_details(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings = Settings(
        foresight_user_id="u_voice_turn_mem",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_turn_mem.json").write_text(
        json.dumps({"user_id": "u_voice_turn_mem", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )

    tr = TranscriptionResult(text="I prefer concise responses", provider="faster_whisper", language="en", timing={})
    route = SlimeVoiceRouteResult(
        intent="general_chat",
        tool_name="no_op",
        arguments={},
        requires_confirmation=False,
    )
    turn = {
        "thread_id": "t1",
        "assistant_text": "Got it.",
        "spoken_sequence": ["Got it."],
        "intent": "general_chat",
        "decision_suggestion": None,
        "memory_updates": ["User prefers concise responses."],
        "memory_update_details": [{"action": "new", "id": "m1", "text": "User prefers concise responses.", "category": "views"}],
        "frontend_action": {"type": "none", "route": "", "payload": {}},
    }
    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command", return_value=route):
            with patch("foresight_x.chat.conversation_service.process_conversation_turn", return_value=turn):
                body = _run_slime_voice_pipeline(
                    b"bytes",
                    "a.webm",
                    "/buddy",
                    None,
                    None,
                    None,
                    settings,
                )
    assert body["memory_updates"] == ["User prefers concise responses."]
    assert body["memory_update_details"][0]["id"] == "m1"


def test_voice_pipeline_route_timeout_falls_back_to_noop(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings = Settings(
        foresight_user_id="u_voice_route_timeout",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
        slime_voice_route_timeout_ms=100,
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_route_timeout.json").write_text(
        json.dumps({"user_id": "u_voice_route_timeout", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    tr = TranscriptionResult(text="open chat", provider="faster_whisper", language="en", timing={})

    def _slow_route(*_a, **_k):
        time.sleep(0.2)
        return SlimeVoiceRouteResult(
            intent="navigate",
            tool_name="navigate",
            arguments={"route": "chat"},
            requires_confirmation=False,
        )

    turn = {
        "thread_id": "t1",
        "assistant_text": "Let us reason it out quickly.",
        "spoken_sequence": ["Let us reason it out quickly."],
        "intent": "general_chat",
        "decision_suggestion": None,
        "memory_updates": [],
        "memory_update_details": [],
        "frontend_action": {"type": "none", "route": "", "payload": {}},
    }

    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command", side_effect=_slow_route):
            with patch("foresight_x.chat.conversation_service.process_conversation_turn", return_value=turn):
                body = _run_slime_voice_pipeline(
                    b"bytes",
                    "a.webm",
                    "/buddy",
                    None,
                    None,
                    None,
                    settings,
                )
    assert body["tool_call"]["name"] == "no_op"
    assert body["assistant_text"] == "Let us reason it out quickly."
    assert body.get("route_timeout_fallback") is True


def test_voice_pipeline_route_timeout_calendar_add_still_returns_confirm_card(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings = Settings(
        foresight_user_id="u_voice_route_timeout_calendar",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
        slime_voice_route_timeout_ms=100,
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_route_timeout_calendar.json").write_text(
        json.dumps({"user_id": "u_voice_route_timeout_calendar", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    tr = TranscriptionResult(
        text="Please add 6 a.m. on Saturday morning for me to watch Arsenal game on execution calendar.",
        provider="faster_whisper",
        language="en",
        timing={},
    )

    def _slow_route(*_a, **_k):
        time.sleep(0.2)
        return SlimeVoiceRouteResult(
            intent="calendar_create",
            tool_name="create_calendar_draft",
            arguments={"title": "ignored"},
            requires_confirmation=False,
        )

    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command", side_effect=_slow_route):
            body = _run_slime_voice_pipeline(
                b"bytes",
                "a.webm",
                "/buddy",
                None,
                None,
                None,
                settings,
            )
    assert body["tool_call"]["name"] == "create_calendar_draft"
    assert body.get("route_timeout_fallback") is True
    assert body["frontend_action"]["type"] == "calendar_draft_confirm"
    assert body.get("tool_timeout_fallback") is False


def test_voice_pipeline_async_tool_postprocess_can_return_pending(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings = Settings(
        foresight_user_id="u_voice_async_post",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
        slime_voice_tool_postprocess_async=True,
        slime_voice_tool_postprocess_wait_ms=0,
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_async_post.json").write_text(
        json.dumps({"user_id": "u_voice_async_post", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    tr = TranscriptionResult(text="go home", provider="faster_whisper", language="en", timing={})
    route = SlimeVoiceRouteResult(
        intent="navigate",
        tool_name="navigate",
        arguments={"route": "home"},
        requires_confirmation=False,
    )

    class _Cap:
        def __init__(self):
            self.saved_texts: list[str] = []
            self.events: list[dict[str, object]] = []

    def _slow_capture(*_a, **_k):
        time.sleep(0.15)
        return _Cap()

    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command", return_value=route):
            with patch("foresight_x.profile.proactive_memory.capture_turn_memory", side_effect=_slow_capture):
                body = _run_slime_voice_pipeline(
                    b"bytes",
                    "a.webm",
                    "/buddy",
                    None,
                    None,
                    None,
                    settings,
                )
    assert body.get("postprocess_pending") is True
    assert body["memory_updates"] == []


def test_voice_pipeline_tool_timeout_falls_back_to_conversation_answer(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    settings = Settings(
        foresight_user_id="u_voice_tool_timeout",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="sk-test",
        slime_voice_tool_timeout_ms=100,
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_tool_timeout.json").write_text(
        json.dumps({"user_id": "u_voice_tool_timeout", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    tr = TranscriptionResult(text="what do you remember about me", provider="faster_whisper", language="en", timing={})
    route = SlimeVoiceRouteResult(
        intent="memory_search",
        tool_name="search_memory",
        arguments={"query": "what do you remember about me", "scope": "all"},
        requires_confirmation=False,
    )
    turn = {
        "thread_id": "t1",
        "assistant_text": "You told me you prefer concise replies.",
        "spoken_sequence": ["You told me you prefer concise replies."],
        "intent": "general_chat",
        "decision_suggestion": None,
        "memory_updates": [],
        "memory_update_details": [],
        "frontend_action": {"type": "none", "route": "", "payload": {}},
    }

    def _slow_tool(*_a, **_k):
        time.sleep(0.2)
        return (
            {"ok": True, "evidence_items": []},
            {"type": "none", "route": "", "payload": {}},
            "slow tool",
        )

    with patch("foresight_x.voice.asr.transcribe_audio", return_value=tr):
        with patch("foresight_x.voice.slime_voice_router.route_slime_voice_command", return_value=route):
            with patch("foresight_x.voice.slime_tools.execute_slime_tool", side_effect=_slow_tool):
                with patch("foresight_x.chat.conversation_service.process_conversation_turn", return_value=turn):
                    body = _run_slime_voice_pipeline(
                        b"bytes",
                        "a.webm",
                        "/buddy",
                        None,
                        None,
                        None,
                        settings,
                    )
    assert body["assistant_text"] == "You told me you prefer concise replies."
    assert body.get("tool_timeout_fallback") is True
    assert body["tool_result"].get("error") == "tool_timeout"


def test_slime_tts_requires_openai_key(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "")
    from foresight_x.ui import api_server

    c = TestClient(api_server.app)
    r = c.post("/api/slime/tts", json={"text": "Hello"})
    assert r.status_code == 503


def test_slime_tts_uses_configured_openai_voice(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ENABLE_CREDIT_LIMITS", "false")
    monkeypatch.setenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    monkeypatch.setenv("OPENAI_TTS_VOICE", "coral")
    monkeypatch.setenv("OPENAI_TTS_INSTRUCTIONS", "Sound like a warm tiny slime.")
    from foresight_x.ui import api_server

    calls: list[dict[str, object]] = []

    class FakeSpeech:
        def create(self, **kwargs):
            calls.append(kwargs)
            return types.SimpleNamespace(read=lambda: b"fake-mp3")

    class FakeOpenAI:
        def __init__(self, *, api_key: str, base_url: str | None = None):
            assert api_key == "sk-test"
            assert base_url is None
            self.audio = types.SimpleNamespace(speech=FakeSpeech())

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    c = TestClient(api_server.app)
    r = c.post("/api/slime/tts", json={"text": "Hello, decision buddy."})

    assert r.status_code == 200
    assert r.content == b"fake-mp3"
    assert calls == [
        {
            "model": "gpt-4o-mini-tts",
            "voice": "coral",
            "input": "Hello, decision buddy.",
            "instructions": "Sound like a warm tiny slime.",
        }
    ]


def test_slime_tts_defaults_to_low_latency_voice(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ENABLE_CREDIT_LIMITS", "false")
    monkeypatch.delenv("OPENAI_TTS_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_TTS_VOICE", raising=False)
    from foresight_x.ui import api_server

    calls: list[dict[str, object]] = []

    class FakeSpeech:
        def create(self, **kwargs):
            calls.append(kwargs)
            return types.SimpleNamespace(read=lambda: b"fake-mp3")

    class FakeOpenAI:
        def __init__(self, *, api_key: str, base_url: str | None = None):
            self.audio = types.SimpleNamespace(speech=FakeSpeech())

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    c = TestClient(api_server.app)
    r = c.post("/api/slime/tts", json={"text": "Hello."})

    assert r.status_code == 200
    assert calls[0]["model"] == "tts-1"
    assert calls[0]["voice"] == "onyx"
    assert "instructions" not in calls[0]


def test_slime_tts_uses_requested_voice_and_speed(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ENABLE_CREDIT_LIMITS", "false")
    monkeypatch.setenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    monkeypatch.setenv("OPENAI_TTS_VOICE", "coral")
    from foresight_x.ui import api_server

    calls: list[dict[str, object]] = []

    class FakeSpeech:
        def create(self, **kwargs):
            calls.append(kwargs)
            return types.SimpleNamespace(read=lambda: b"fake-mp3")

    class FakeOpenAI:
        def __init__(self, *, api_key: str, base_url: str | None = None):
            self.audio = types.SimpleNamespace(speech=FakeSpeech())

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    c = TestClient(api_server.app)
    r = c.post("/api/slime/tts", json={"text": "Hello.", "voice": "onyx", "speed": 1.2})

    assert r.status_code == 200
    assert calls[0]["voice"] == "onyx"
    assert calls[0]["speed"] == 1.2


def test_slime_tts_maps_legacy_browser_voice_to_tts_voice(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FORESIGHT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ENABLE_CREDIT_LIMITS", "false")
    from foresight_x.ui import api_server

    calls: list[dict[str, object]] = []

    class FakeSpeech:
        def create(self, **kwargs):
            calls.append(kwargs)
            return types.SimpleNamespace(read=lambda: b"fake-mp3")

    class FakeOpenAI:
        def __init__(self, *, api_key: str, base_url: str | None = None):
            self.audio = types.SimpleNamespace(speech=FakeSpeech())

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    c = TestClient(api_server.app)
    r = c.post("/api/slime/tts", json={"text": "Hello.", "voice": "Eddy (English (United States))"})

    assert r.status_code == 200
    assert calls[0]["voice"] == "onyx"


def test_navigate_tool_validates_route() -> None:
    tr, fe = tool_navigate({"route": "execution_calendar"})
    assert tr["ok"] is True
    assert fe["route"] == "/execution"
    tr_bad, fe_bad = tool_navigate({"route": "https://evil.test"})
    assert tr_bad["ok"] is False
    assert fe_bad["type"] == "none"


def test_search_calendar_tool_summarizes_today(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_calendar_search",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    upsert_event(
        settings,
        "u_calendar_search",
        CalendarEvent(
            id="evt-1",
            title="Lab meeting",
            start="2026-05-12T14:00:00+00:00",
            end="2026-05-12T15:00:00+00:00",
            source="manual",
        ),
    )
    tr, fe = tool_search_calendar(
        {"query": "what do I have today", "range": "today"},
        settings=settings,
        now=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc),
    )
    assert tr["ok"] is True
    assert tr["total"] == 1
    assert tr["events"][0]["title"] == "Lab meeting"
    assert fe["type"] == "show_calendar_result"


def test_schedule_decision_plan_without_id_falls_back_to_calendar_draft(tmp_path: Path) -> None:
    """Router sometimes picks schedule_decision_plan without a trace id; user meant a normal calendar add."""
    settings = Settings(
        foresight_user_id="u_cal_fb",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_cal_fb.json").write_text(
        json.dumps({"user_id": "u_cal_fb", "memory_facts": [], "priority_lines": [], "about_me": ""}),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_cal_fb", recent_ui_context={"timezone": "UTC"})
    route = SlimeVoiceRouteResult(
        intent="calendar_plan",
        tool_name="schedule_decision_plan",
        arguments={},
        requires_confirmation=False,
    )
    tr, fe, text = execute_slime_tool(
        route,
        ctx,
        settings=settings,
        transcript="Put this detailed plan on my execution calendar tomorrow afternoon",
    )
    assert tr.get("ok") is True
    assert fe.get("type") == "calendar_draft_confirm"
    assert text


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


def test_route_slime_voice_your_name_is_without_openai_key() -> None:
    settings = Settings(openai_api_key="")
    ctx = SlimeVoiceContext(user_id="demo_user")
    r = route_slime_voice_command("Okay, your name is Luna now.", ctx, settings=settings)
    assert r.tool_name == "update_slime_profile"
    assert r.arguments["patch"]["name"] == "Luna"
    assert r.requires_confirmation is False
    assert r.auto_apply_voice_rename is True


def test_route_slime_voice_chinese_rename_without_openai_key() -> None:
    settings = Settings(openai_api_key="")
    ctx = SlimeVoiceContext(user_id="demo_user")
    r = route_slime_voice_command("把你的名字改成团子", ctx, settings=settings)
    assert r.tool_name == "update_slime_profile"
    assert r.arguments["patch"]["name"] == "团子"
    assert r.auto_apply_voice_rename is True


def test_deterministic_voice_rename_persists_without_confirm(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_rename",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_rename.json").write_text(
        json.dumps(
            {
                "user_id": "u_voice_rename",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_rename")
    route = route_slime_voice_command("Your name is Pebble.", ctx, settings=settings)
    assert route.auto_apply_voice_rename is True
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="Your name is Pebble.")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.name == "Pebble"


def test_route_voice_slime_name_phrase_renames_slime_not_calendar(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_rename_slime_name_phrase",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_rename_slime_name_phrase")
    route = route_slime_voice_command(
        "Oh, I mean, can you change your slime name into Adam?",
        ctx,
        settings=settings,
    )
    assert route.tool_name == "update_slime_profile"
    assert route.arguments["patch"]["name"] == "Adam"
    assert route.auto_apply_voice_rename is True


def test_route_voice_from_now_on_slime_rename_persists_without_confirm(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_rename_phrase",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_rename_phrase.json").write_text(
        json.dumps(
            {
                "user_id": "u_voice_rename_phrase",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_rename_phrase")
    route = route_slime_voice_command("From now on, your name is Pebble.", ctx, settings=settings)
    assert route.tool_name == "update_slime_profile"
    assert route.auto_apply_voice_rename is True
    tr, fe, _assistant = execute_slime_tool(
        route,
        ctx,
        settings=settings,
        transcript="From now on, your name is Pebble.",
    )
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.name == "Pebble"


def test_route_slime_voice_rename_skips_when_call_me_present() -> None:
    settings = Settings(openai_api_key="")
    ctx = SlimeVoiceContext(user_id="demo_user")
    r = route_slime_voice_command("Call me Sam and also your name is Blob", ctx, settings=settings)
    assert r.tool_name == "no_op"


def test_route_slime_voice_opinion_skips_router_llm() -> None:
    settings = Settings(openai_api_key="sk-test")
    ctx = SlimeVoiceContext(user_id="demo_user")
    with patch(
        "foresight_x.voice.slime_voice_router.structured_predict",
        side_effect=AssertionError("router LLM should be skipped"),
    ):
        r = route_slime_voice_command("Do you like Messi?", ctx, settings=settings)
    assert r.tool_name == "no_op"
    assert r.intent == "general_chat"
    assert r.arguments["reason"] == "fast_conversation"


def test_route_slime_voice_memory_question_skips_router_llm() -> None:
    settings = Settings(openai_api_key="sk-test")
    ctx = SlimeVoiceContext(user_id="demo_user")
    with patch(
        "foresight_x.voice.slime_voice_router.structured_predict",
        side_effect=AssertionError("router LLM should be skipped"),
    ):
        r = route_slime_voice_command("Who is my girlfriend?", ctx, settings=settings)
    assert r.tool_name == "search_memory"
    assert r.arguments["scope"] == "all"
    assert "girlfriend" in r.arguments["query"].lower()


def test_route_slime_voice_change_tts_voice_without_openai_key() -> None:
    settings = Settings(openai_api_key="")
    ctx = SlimeVoiceContext(user_id="demo_user")
    r = route_slime_voice_command("Change your voice to Eddy.", ctx, settings=settings)
    assert r.tool_name == "update_slime_profile"
    assert r.arguments["patch"]["voice"]["preferred_voice_name"] == "onyx"


def test_is_safe_hyphenated_apostrophe_slime_display_name() -> None:
    from foresight_x.voice.slime_text_safety import is_safe_slime_display_name

    assert is_safe_slime_display_name("Anne-Marie")
    assert is_safe_slime_display_name("O'Brien")


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


def test_profile_update_accepts_top_level_user_nickname_patch(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_nick_top",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_nick_top.json").write_text(
        json.dumps(
            {
                "user_id": "u_nick_top",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_nick_top")
    route = SlimeVoiceRouteResult(
        intent="profile_update",
        tool_name="update_slime_profile",
        arguments={"patch": {"user_nickname": "boss"}},
        requires_confirmation=False,
        auto_apply_voice_persona=True,
    )
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="from now on you call me boss")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.persona.user_nickname == "boss"


def test_route_voice_call_me_persists_without_confirm(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_nick",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_nick.json").write_text(
        json.dumps(
            {
                "user_id": "u_voice_nick",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_nick")
    route = route_slime_voice_command("以后叫我老板", ctx, settings=settings)
    assert route.tool_name == "update_slime_profile"
    assert route.auto_apply_voice_persona is True
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="以后叫我老板")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.persona is not None
    assert loaded.slime_profile.persona.user_nickname == "老板"


def test_route_voice_from_now_on_you_call_me_persists_without_confirm(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_nick_phrase",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_nick_phrase.json").write_text(
        json.dumps(
            {
                "user_id": "u_voice_nick_phrase",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_nick_phrase")
    route = route_slime_voice_command("From now on, you call me boss.", ctx, settings=settings)
    assert route.tool_name == "update_slime_profile"
    assert route.auto_apply_voice_persona is True
    tr, fe, _assistant = execute_slime_tool(
        route,
        ctx,
        settings=settings,
        transcript="From now on, you call me boss.",
    )
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.persona is not None
    assert loaded.slime_profile.persona.user_nickname == "boss"


def test_route_voice_ni_jiao_wo_persists_without_confirm(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_voice_nick_cn",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_voice_nick_cn.json").write_text(
        json.dumps(
            {
                "user_id": "u_voice_nick_cn",
                "memory_facts": [],
                "priority_lines": [],
                "about_me": "",
                "slime_profile": {"name": "Mochi", "color_theme": "violet", "personality": "calm"},
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_voice_nick_cn")
    route = route_slime_voice_command("以后你叫我老板", ctx, settings=settings)
    assert route.tool_name == "update_slime_profile"
    assert route.auto_apply_voice_persona is True
    tr, fe, _assistant = execute_slime_tool(route, ctx, settings=settings, transcript="以后你叫我老板")
    assert tr.get("ok") is True
    assert fe.get("type") == "slime_profile_refresh"
    from foresight_x.profile.store import load_user_profile

    loaded = load_user_profile(settings)
    assert loaded.slime_profile is not None
    assert loaded.slime_profile.persona is not None
    assert loaded.slime_profile.persona.user_nickname == "老板"


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
    assert fe["payload"].get("display_mode") == "chips"
    assert isinstance(tr.get("evidence_items"), list)
    assert len(tr["evidence_items"]) >= 1
    assert "• From your profile" not in assistant
    assert "From your profile memory:" not in assistant


def test_memory_search_direct_question_uses_concrete_profile_fact(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_memory_direct",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_memory_direct.json").write_text(
        json.dumps(
            {
                "user_id": "u_memory_direct",
                "memory_facts": [
                    {
                        "id": "f1",
                        "category": "identity",
                        "confidence": 0.91,
                        "importance": 0.87,
                        "created_at": "2026-05-01T10:00:00Z",
                        "updated_at": "2026-05-12T10:00:00Z",
                        "text": "Rose is my girlfriend and we plan October visits.",
                        "subject_ref": "user",
                        "predicate": "dating",
                        "object_value": "Rose",
                        "evidence": "my girlfriend Rose",
                    },
                    {
                        "id": "f2",
                        "category": "behavior",
                        "text": "I am studying computer science and building Foresight-X.",
                    },
                ],
                "priority_lines": [],
                "about_me": "",
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_memory_direct")
    route = SlimeVoiceRouteResult(
        intent="memory_search",
        tool_name="search_memory",
        arguments={"query": "Who is my girlfriend and what is my life like?", "scope": "all"},
        requires_confirmation=False,
    )
    tr, _fe, assistant = execute_slime_tool(
        route,
        ctx,
        settings=settings,
        transcript="Who is my girlfriend and what is my life like?",
    )
    assert "Rose" in assistant
    assert "girlfriend" in assistant.lower()
    assert any("structured:" in str(item.get("fullText") or "") for item in tr["evidence_items"])
    assert any(item.get("category") == "identity" for item in tr["evidence_items"])
    assert any(item.get("createdAt") == "2026-05-01T10:00:00Z" for item in tr["evidence_items"])
    assert any("Foresight-X" in str(hit.get("text") or "") for hit in tr["hits"])


def test_memory_search_broad_recall_balances_structured_memory_categories(tmp_path: Path) -> None:
    settings = Settings(
        foresight_user_id="u_memory_balanced",
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        openai_api_key="",
    )
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile" / "u_memory_balanced.json").write_text(
        json.dumps(
            {
                "user_id": "u_memory_balanced",
                "about_me": "I am a student building useful AI interfaces.",
                "priority_lines": [
                    {"id": f"p{i}", "text": f"Decision clarification preference {i}: I like explicit constraints."}
                    for i in range(12)
                ],
                "memory_facts": [
                    {
                        "id": "rel",
                        "category": "identity",
                        "text": "Rose is my girlfriend.",
                        "predicate": "dating",
                        "object_value": "Rose",
                        "importance": 0.9,
                    },
                    {
                        "id": "proj",
                        "category": "goals",
                        "text": "I am building Foresight-X as a project.",
                        "predicate": "works_on",
                        "object_value": "Foresight-X",
                        "importance": 0.88,
                    },
                    {
                        "id": "constraint",
                        "category": "constraints",
                        "text": "I have limited time during heavy coursework weeks.",
                        "predicate": "limited_by",
                        "object_value": "coursework",
                        "importance": 0.8,
                    },
                    {
                        "id": "behavior",
                        "category": "behavior",
                        "text": "I iterate quickly on UI details after trying the demo.",
                        "importance": 0.65,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    ctx = SlimeVoiceContext(user_id="u_memory_balanced")
    route = SlimeVoiceRouteResult(
        intent="memory_search",
        tool_name="search_memory",
        arguments={"query": "What do you remember about me?", "scope": "all"},
        requires_confirmation=False,
    )
    tr, _fe, assistant = execute_slime_tool(route, ctx, settings=settings, transcript="What do you remember about me?")
    hit_text = " ".join(str(h.get("text") or "") for h in tr["hits"])
    assert "Rose" in hit_text
    assert "Foresight-X" in hit_text
    assert "coursework" in hit_text
    assert "Decision clarification preference 11" not in hit_text
    assert "girlfriend" in assistant or "Foresight-X" in assistant


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
