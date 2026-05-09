"""
Pluggable ASR: default faster-whisper (local), optional OpenAI Whisper.

Future: OpenAI Realtime API for low-latency speech-to-speech (not implemented here).
TODO: WhisperX, Vosk providers when needed.
"""

from __future__ import annotations

import io
import logging
import os
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from foresight_x.config import Settings, load_settings

_log = logging.getLogger(__name__)

_model_cache: dict[tuple[str, str, str], Any] = {}
_model_load_ms: dict[tuple[str, str, str], float] = {}


class TranscriptionResult(BaseModel):
    text: str
    language: str | None = None
    duration_seconds: float | None = None
    provider: str
    confidence: float | None = None
    timing: dict[str, Any] | None = None


def _asr_provider_from_env() -> str:
    return (os.getenv("ASR_PROVIDER") or "faster_whisper").strip().lower()


def _fw_model_name() -> str:
    return (os.getenv("FASTER_WHISPER_MODEL") or "small").strip()


def _fw_device() -> str:
    return (os.getenv("FASTER_WHISPER_DEVICE") or "auto").strip()


def _fw_compute_type() -> str:
    return (os.getenv("FASTER_WHISPER_COMPUTE_TYPE") or "auto").strip()


def _fw_language() -> str | None:
    raw = (os.getenv("FASTER_WHISPER_LANGUAGE") or "auto").strip().lower()
    if raw in ("", "auto"):
        return None
    return raw


def get_faster_whisper_model():
    """Lazy-load WhisperModel once per process (keyed by model, device, compute_type)."""
    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError as e:
        raise RuntimeError(
            "faster-whisper is not installed. From the repo root run: pip install -e '.[web]' "
            "(or pip install 'faster-whisper>=1,<2'). Alternatively set ASR_PROVIDER=openai and configure OPENAI_API_KEY."
        ) from e

    model_name = _fw_model_name()
    device = _fw_device()
    compute_type = _fw_compute_type()
    key = (model_name, device, compute_type)
    if key not in _model_cache:
        t0 = time.perf_counter()
        _log.info("Loading faster-whisper model=%s device=%s compute_type=%s", model_name, device, compute_type)
        _model_cache[key] = WhisperModel(model_name, device=device, compute_type=compute_type)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _model_load_ms[key] = elapsed_ms
        _log.info("faster-whisper model load complete in %.0f ms", elapsed_ms)
    return _model_cache[key], key


def warmup_asr_model() -> None:
    """Eagerly load faster-whisper when ASR_PROVIDER=faster_whisper."""
    if _asr_provider_from_env() != "faster_whisper":
        return
    get_faster_whisper_model()


def transcribe_with_faster_whisper(audio_path: str | Path, *, settings: Settings | None = None) -> TranscriptionResult:
    if settings is None:
        load_settings()
    path = Path(audio_path)
    if not path.is_file():
        raise FileNotFoundError(str(path))

    model, key = get_faster_whisper_model()
    load_ms = _model_load_ms.get(key)

    lang = _fw_language()
    t0 = time.perf_counter()
    try:
        segments, info = model.transcribe(
            str(path),
            language=lang,
            vad_filter=True,
        )
    except Exception as e:
        msg = str(e).lower()
        if "ffmpeg" in msg or "av" in msg or "decode" in msg or "could not load" in msg:
            raise RuntimeError(
                "Could not decode audio. Install ffmpeg or send WAV/PCM supported by faster-whisper."
            ) from e
        raise

    parts: list[str] = []
    for seg in segments:
        t = (getattr(seg, "text", None) or "").strip()
        if t:
            parts.append(t)
    text = " ".join(parts).strip()
    transcribe_ms = (time.perf_counter() - t0) * 1000
    duration = float(getattr(info, "duration", 0) or 0) or None
    language = getattr(info, "language", None) or None
    rt_factor = None
    if duration and duration > 0:
        rt_factor = transcribe_ms / (duration * 1000)

    timing = {
        "asr_model_load_ms": load_ms,
        "transcription_ms": transcribe_ms,
        "audio_duration_seconds": duration,
        "realtime_factor": rt_factor,
        "provider": "faster_whisper",
        "model": key[0],
    }
    _log.info(
        "faster-whisper transcribe: %.0f ms, audio=%.2fs, rt_factor=%s",
        transcribe_ms,
        duration or -1.0,
        f"{rt_factor:.3f}" if rt_factor is not None else "n/a",
    )
    return TranscriptionResult(
        text=text,
        language=language,
        duration_seconds=duration,
        provider="faster_whisper",
        confidence=None,
        timing=timing,
    )


def transcribe_with_openai(audio_path: str | Path, *, settings: Settings | None = None) -> TranscriptionResult:
    settings = settings or load_settings()
    if not (settings.openai_api_key or "").strip():
        raise RuntimeError("OpenAI transcription requires OPENAI_API_KEY")
    try:
        from openai import OpenAI
    except ImportError as e:
        raise RuntimeError("openai package required for OpenAI transcription") from e

    path = Path(audio_path)
    raw = path.read_bytes()
    if not raw:
        raise ValueError("empty audio file")

    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_api_base or None)
    buf = io.BytesIO(raw)
    buf.name = path.name or "audio.webm"
    t0 = time.perf_counter()
    try:
        tr = client.audio.transcriptions.create(model="whisper-1", file=buf)
    except Exception as e:
        raise RuntimeError(f"OpenAI transcription failed: {e!s}") from e
    transcribe_ms = (time.perf_counter() - t0) * 1000
    text = (getattr(tr, "text", None) or "").strip()
    timing = {
        "asr_model_load_ms": None,
        "transcription_ms": transcribe_ms,
        "audio_duration_seconds": None,
        "realtime_factor": None,
        "provider": "openai",
        "model": "whisper-1",
    }
    return TranscriptionResult(
        text=text,
        language=None,
        duration_seconds=None,
        provider="openai",
        confidence=None,
        timing=timing,
    )


def transcribe_with_whisperx(_audio_path: str | Path, *, settings: Settings | None = None) -> TranscriptionResult:
    _ = settings
    raise NotImplementedError("WhisperX ASR is not enabled in this build (TODO).")


def transcribe_with_vosk(_audio_path: str | Path, *, settings: Settings | None = None) -> TranscriptionResult:
    _ = settings
    raise NotImplementedError("Vosk ASR is not enabled in this build (TODO).")


def transcribe_audio(audio_path: str | Path, *, settings: Settings | None = None) -> TranscriptionResult:
    """Dispatch to configured ASR provider (ASR_PROVIDER env)."""
    prov = _asr_provider_from_env()
    if prov in ("faster_whisper", "faster-whisper"):
        return transcribe_with_faster_whisper(audio_path, settings=settings)
    if prov == "openai":
        return transcribe_with_openai(audio_path, settings=settings)
    if prov == "whisperx":
        return transcribe_with_whisperx(audio_path, settings=settings)
    if prov == "vosk":
        return transcribe_with_vosk(audio_path, settings=settings)
    raise ValueError(f"Unsupported ASR_PROVIDER: {prov!r} (use faster_whisper, openai, whisperx, vosk)")
