# Slime Voice Agent

## Product behavior

On **Buddy** (`/buddy`), the user taps a **mic** near the Slime for **push-to-talk**: record → stop → transcribe → route → optional **speechSynthesis** and **safe** UI actions.

This is **not** continuous realtime voice; it is intentionally simple and privacy-conscious (no raw audio persistence by default).

## Architecture

1. **Browser:** `MediaRecorder` captures audio (typically `audio/webm`).
2. **POST** `multipart/form-data` to `/api/slime/voice-command` with field `audio` and optional `current_route`, `thread_id`, `slime_profile` (JSON string), `recent_ui_context` (JSON string).
3. **Server:** saves bytes to a **temp file**, runs `foresight_x.voice.asr.transcribe_audio`, then `route_slime_voice_command` (GPT-4o mini structured output), then `execute_slime_tool` (validated tools).
4. **Response:** `transcript`, `asr_provider`, `language`, `assistant_text`, `intent`, `tool_call`, `tool_result`, `frontend_action`, `requires_confirmation`, `timing`.
5. **Browser:** updates bubble text, optional TTS (after user gesture), applies **whitelisted** `frontend_action` (navigation + sessionStorage payloads for chat prefill / calendar draft).

**Future:** OpenAI **Realtime API** for end-to-end streaming audio + tools — TODO only.

## Tool routing (GPT-4o mini)

Implemented in `foresight_x/voice/slime_voice_router.py`. The model must pick one of:

- `navigate` — enum routes only (`home`, `profile`, `shadow_chat`, `execution_calendar`, `history`, `settings`).
- `search_memory` — server runs keyword search over profile facts, chat threads, and trace previews (no invented text).
- `create_calendar_draft` — returns a **draft** payload; Execution Calendar adds a **manual** block (user edits/removes).
- `open_decision_report_flow` — opens `/chat` with a **prefilled** composer message (sessionStorage).
- `update_slime_profile` — validated patch; **confirmation** for names/custom colors / when the model sets `requires_confirmation`.
- `open_shadow_chat` — navigate to `/chat` with optional prefill.
- `no_op` — safe conversational fallback.

## Tool execution and validation

`foresight_x/voice/slime_tools.py`:

- **Navigation** paths are fixed in `ROUTE_TO_PATH` (no arbitrary URLs).
- **Memory** search does not call an LLM to “recall”; it scores stored text only. If nothing matches: *“I don't see a stored memory for that yet.”*
- **Calendar** never creates a final committed event server-side in this flow; the planner adds a **draft** event locally.
- **Profile** updates use Pydantic enums and hex validation for custom colors.

## User id

The API uses `_settings_for_active_user()` — the active **persona** / `FORESIGHT_USER_ID` from the server; the client must **not** supply a trusted `user_id`.

## Running locally

1. Install backend deps (including `faster-whisper`) and **ffmpeg** (see [voice_asr.md](./voice_asr.md)).
2. Set `OPENAI_API_KEY` for tool routing (ASR can stay local).
3. Example:

```bash
export ASR_PROVIDER=faster_whisper
export FASTER_WHISPER_MODEL=small
export FASTER_WHISPER_DEVICE=auto
export FASTER_WHISPER_COMPUTE_TYPE=int8
export FASTER_WHISPER_LANGUAGE=auto
export ASR_WARMUP_ON_START=false
uvicorn foresight_x.ui.api_server:app --reload
```

4. Web: open `#/buddy`, allow microphone when prompted, talk to the Slime.

## Frontend mapping

Voice UI states map to `SlimeAdvisor` animation states: `listening` → attentive pulse; transcribing/thinking → `thinking`; speaking → `speaking` (and TTS when enabled); errors → `cautious`.
