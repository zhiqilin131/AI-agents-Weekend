# Slime voice — ASR (automatic speech recognition)

## Overview

The Slime Voice Agent sends short **push-to-talk** recordings to `POST /api/slime/voice-command`. The server writes audio to a **temporary file**, runs **pluggable ASR**, then uses **GPT-4o mini** for structured tool routing (see [voice_slime_agent.md](./voice_slime_agent.md)).

**Future:** OpenAI **Realtime API** for streaming speech-to-speech and lower latency — intentionally **not** implemented in this pass (see TODOs in code).

## Providers

| `ASR_PROVIDER`   | Description |
|------------------|-------------|
| `faster_whisper` | **Default.** Local open-source Whisper via [faster-whisper](https://github.com/SYSTRAN/faster-whisper). |
| `openai`         | OpenAI `whisper-1` HTTP API (optional fallback; requires `OPENAI_API_KEY`). |
| `whisperx`       | TODO — not wired in this build. |
| `vosk`           | TODO — not wired in this build. |

## Environment variables

| Variable | Default | Notes |
|----------|---------|--------|
| `ASR_PROVIDER` | `faster_whisper` | `openai` \| `faster_whisper` \| `whisperx` \| `vosk` |
| `FASTER_WHISPER_MODEL` | `small` | e.g. `tiny`, `base`, `small`, `medium`, `large-v3`, `distil-large-v3` |
| `FASTER_WHISPER_DEVICE` | `auto` | `cpu`, `cuda`, `auto`, … |
| `FASTER_WHISPER_COMPUTE_TYPE` | `auto` | e.g. `int8` on CPU, `float16` on GPU |
| `FASTER_WHISPER_LANGUAGE` | `auto` | ISO code or `auto` for detection |
| `ASR_WARMUP_ON_START` | `false` | If `true`, loads the Whisper model at API startup (slower boot, faster first request). |

## ffmpeg

Browsers typically record **WebM/Opus**. **faster-whisper** usually relies on **ffmpeg** to decode those containers. If decoding fails, the API returns a clear error suggesting installing ffmpeg or sending WAV.

**macOS (Homebrew):** `brew install ffmpeg`  
**Ubuntu:** `sudo apt install ffmpeg`

## Recommended models

- **Local dev:** `small` — good speed/quality balance on CPU with `int8`.
- **Better multilingual:** `medium` or `large-v3` (prefer GPU).
- **Faster English-only:** `distil-large-v3` or other distilled checkpoints supported by faster-whisper.

## Switching to OpenAI transcription

```bash
export ASR_PROVIDER=openai
export OPENAI_API_KEY=...
```

The separate legacy endpoint `POST /api/transcribe` still uses OpenAI only (used by the generic upload button in the UI).

## Performance logging

Responses include `timing` with `transcription_ms`, `asr_model_load_ms` (on first load), `realtime_factor`, `intent_route_ms`, `tool_execute_ms`, and `total_ms`.
