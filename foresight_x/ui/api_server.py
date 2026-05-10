"""FastAPI server for the Foresight-X web UI (Vite dev proxy → /api/*)."""

from __future__ import annotations

import os
from typing import Any, Literal
import json
import uuid
from datetime import datetime, timezone
import asyncio
import tempfile
from contextlib import asynccontextmanager

import io
import logging
import re
from pathlib import Path
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
import time

import chromadb
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError, field_validator

from foresight_x.config import load_settings
from foresight_x.harness.improvement_loop import apply_outcome_to_memory
from foresight_x.harness.outcome_tracker import load_decision_outcome, save_decision_outcome
from foresight_x.harness.trace import load_decision_trace
from foresight_x.resources.resource_drops import (
    calendar_fallback_drops,
    generate_resource_drops_for_recommendation,
    resource_drops_as_json,
)
from foresight_x.harness.decision_commit import load_commit, save_commit
from foresight_x.harness.evaluation_log import append_evaluation_log, build_evaluation_record
from foresight_x.harness.trace_index import delete_trace, list_traces
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.orchestration.pipeline import PipelineContext, iter_pipeline_events, run_pipeline
from foresight_x.perception.clarify_gate import merge_clarification_answers, run_clarify_gate
from foresight_x.perception.clarification_gate import (
    build_fast_clarify_questions,
    build_timeout_fallback_questions,
    default_clarification_state,
    fast_gate_timing_ms,
    should_show_clarification_fast,
)
from foresight_x.perception.personalized_clarify import (
    heuristic_domain,
    persist_clarification_followup,
    run_personalized_clarify_gate,
)
from foresight_x.profile.merge import (
    append_profile_memory_records,
    delete_memory_fact_by_id,
    delete_priority_line_by_id,
)
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.diary.generator import attach_links, generate_diary_entry
from foresight_x.diary.source_adapter import bundle_has_activity, collect_diary_sources_for_date
from foresight_x.diary.store import load_entry, load_entry_by_id, list_month_summaries, save_entry, stamp_times
from foresight_x.schemas import (
    DecisionCommit,
    DecisionOutcome,
    MemoryFactCategory,
    ProfileLine,
    ProfileMemoryFact,
    SlimeAccessory,
    SlimeColorTheme,
    SlimeCustomColors,
    SlimeMotion,
    SlimePersonality,
    SlimePersona,
    SlimeProfile,
    SlimeShape,
    SlimeVoicePreferences,
    UserProfile,
)
from foresight_x.chat.slime_intent import classify_slime_intent, merge_with_decision_intent
from foresight_x.voice.slime_identity import get_effective_slime_persona
from foresight_x.voice.slime_persona_prompt import (
    build_slime_persona_prompt,
    build_slime_self_identity_prompt,
    merge_persona_patch,
    merge_slime_persona_defaults,
)
from foresight_x.voice.slime_profile_nl import try_apply_slime_profile_from_chat_message
from foresight_x.voice.slime_self_model import get_effective_slime_self_model
from foresight_x.ui.cli import _build_context
from foresight_x.memory_graph import TemporalGraphMemory
from foresight_x.memory.profile_store import empty_profile as load_tier3_empty_profile
from foresight_x.memory.profile_store import load_profile as load_tier3_profile
from foresight_x.memory.profile_store import save_profile as save_tier3_profile
from foresight_x.personalization.ingest import ingest_personalization_text, preview_extract_summary
from foresight_x.shadow.chat import run_shadow_turn
from foresight_x.shadow.thread_context import append_temporary_context_items, format_temporary_context_prompt
from foresight_x.shadow.thread_summary import maybe_update_thread_summary
from foresight_x.structured_predict import structured_predict
from foresight_x.chat import (
    append_message,
    create_thread,
    delete_thread,
    detect_chat_intent,
    detect_chat_mode_intent,
    list_threads,
    load_thread,
    save_thread,
)
from foresight_x.chat.thread_store import append_clarification_event
from foresight_x.auth import (
    decode_supabase_access_token,
    get_current_user,
    get_supabase_user_for_request,
    supabase_user_ctx_reset,
    supabase_user_ctx_set,
)
from foresight_x.db.supabase_client import get_supabase_for_user
from foresight_x.decision_algorithms import (
    build_agility_preview,
    build_influence_graph_from_trace,
    evaluate_options_mcda,
    evaluate_robustness,
    generate_consequence_scenarios,
    schedule_with_ortools,
)
from foresight_x.decision_algorithms.schemas import (
    CalendarEvent as AlgoCalendarEvent,
    ExecutionTask as AlgoExecutionTask,
    SchedulerOptions as AlgoSchedulerOptions,
)
from foresight_x.ui.calendar_feedback_interpreter import interpret_calendar_feedback
from foresight_x.calendar_agent.calendar_service import (
    alternatives_for_draft,
    build_draft_from_intent,
    confirm_draft,
    draft_from_report,
)
from foresight_x.calendar_agent.memory_preferences import get_calendar_preferences
from foresight_x.calendar_agent.nl_parser import parse_calendar_intent
from foresight_x.calendar_agent.schemas import CalendarEvent as AgentCalendarEvent
from foresight_x.calendar_agent.schemas import CalendarIntent as AgentCalendarIntent
from foresight_x.calendar_agent.schemas import CalendarSource as AgentCalendarSource
from foresight_x.calendar_agent.schemas import CalendarTask as AgentCalendarTask
from foresight_x.calendar_agent.store import (
    delete_event as cal_agent_delete_event,
    list_events as cal_agent_list_events,
    replace_events as cal_agent_replace_events,
    upsert_event as cal_agent_upsert_event,
)
from foresight_x.calendar_agent import ics_service as cal_ics_service


_log = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _trace_artifact_summary(trace: dict | None) -> str:
    if not trace or not isinstance(trace, dict):
        return "Generated from this conversation"
    us = trace.get("user_state")
    if isinstance(us, dict):
        s = str(us.get("situation") or "").strip()
        if s:
            return (s[:180] + "…") if len(s) > 180 else s
    return "Generated from this conversation"


def _sse_chunk(obj: dict) -> str:
    """SSE line; ``default=str`` avoids rare non-JSON-native values aborting the stream."""
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


# Uvicorn/proxies may close chunked SSE early without these → browser ERR_INCOMPLETE_CHUNKED_ENCODING.
_SSE_STREAM_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse_streaming_response(body) -> StreamingResponse:
    return StreamingResponse(body, media_type="text/event-stream", headers=dict(_SSE_STREAM_HEADERS))


class PersonaItem(BaseModel):
    user_id: str = Field(min_length=1)
    created_at: str = Field(default="")


class PersonaRegistry(BaseModel):
    current_user_id: str
    users: list[PersonaItem]


class PersonaCreateRequest(BaseModel):
    user_id: str = Field(min_length=1)


class PersonaSwitchRequest(BaseModel):
    user_id: str = Field(min_length=1)


_USER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")
_PERSONA_LOCK = Lock()


def _validate_user_id_or_400(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not _USER_ID_RE.match(uid):
        raise HTTPException(
            status_code=400,
            detail="Invalid user_id. Use 2-64 chars: letters, numbers, underscore, hyphen.",
        )
    return uid


def _default_user_id(settings=None) -> str:
    s = settings or load_settings()
    return (s.foresight_user_id or "demo_user").strip() or "demo_user"


def _sanitize_mem_collection_suffix(user_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", user_id.strip())[:120]


def _persona_registry_path(settings=None) -> Path:
    s = settings or load_settings()
    return s.foresight_data_dir / "personas_registry.json"


def _ensure_registry(settings=None) -> PersonaRegistry:
    s = settings or load_settings()
    p = _persona_registry_path(s)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.is_file():
        try:
            data = PersonaRegistry.model_validate_json(p.read_text(encoding="utf-8"))
            if data.users:
                return data
        except Exception:
            pass
    now = _utc_now()
    default_uid = _default_user_id(s)
    data = PersonaRegistry(
        current_user_id=default_uid,
        users=[PersonaItem(user_id=default_uid, created_at=now)],
    )
    p.write_text(data.model_dump_json(indent=2), encoding="utf-8")
    return data


def _save_registry(reg: PersonaRegistry, settings=None) -> Path:
    s = settings or load_settings()
    p = _persona_registry_path(s)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(reg.model_dump_json(indent=2), encoding="utf-8")
    return p


def _auth_exempt_path(path: str) -> bool:
    """Paths that skip REQUIRE_AUTH enforcement (CORS preflight handled earlier)."""
    p = path.rstrip("/") or "/"
    if p in ("/", "/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico"):
        return True
    if p == "/api/health":
        return True
    return False


def _active_user_id(settings=None) -> str:
    s = settings or load_settings()
    ctx_user = get_supabase_user_for_request()
    if ctx_user and (ctx_user.get("id") or "").strip():
        return str(ctx_user["id"]).strip()
    reg = _ensure_registry(s)
    uid = (reg.current_user_id or "").strip()
    return uid or _default_user_id(s)


def _settings_for_active_user():
    s = load_settings()
    uid = _active_user_id(s)
    return s.model_copy(update={"foresight_user_id": uid})


def _persona_settings(user_id: str):
    s = load_settings()
    return s.model_copy(update={"foresight_user_id": user_id})


def _delete_persona_data(user_id: str, settings=None) -> None:
    s = settings or load_settings()
    paths = [
        s.profile_dir / f"{user_id}.json",
        s.foresight_data_dir / "profiles" / f"{user_id}.json",
        s.foresight_data_dir / "shadow_self" / f"{user_id}.json",
    ]
    for p in paths:
        if p.is_file():
            p.unlink()
    try:
        client = chromadb.PersistentClient(path=str(s.chroma_persist_dir))
        client.delete_collection(name=f"fx_mem_{_sanitize_mem_collection_suffix(user_id)}")
    except Exception:
        # Missing collection is fine.
        pass


def _trace_user_id(trace: dict | object) -> str:
    try:
        us = getattr(trace, "user_state", None)
        if us is not None:
            return str(getattr(us, "active_user_id", "") or "").strip()
        if isinstance(trace, dict):
            us_raw = trace.get("user_state") or {}
            if isinstance(us_raw, dict):
                return str(us_raw.get("active_user_id", "") or "").strip()
    except Exception:
        return ""
    return ""


def _trace_visible_to_current(trace_user_id: str, current_user_id: str) -> bool:
    owner = (trace_user_id or "").strip()
    current = (current_user_id or "").strip()
    if owner:
        return owner == current
    # Legacy traces without owner stay with demo_user for backward compatibility.
    return current == "demo_user"


def _default_slime_profile() -> SlimeProfile:
    return SlimeProfile(
        name="Mochi",
        color_theme=SlimeColorTheme.VIOLET,
        personality=SlimePersonality.CALM,
        shape=SlimeShape.CLASSIC,
        accessory=SlimeAccessory.NONE,
        motion=SlimeMotion.NORMAL,
        updated_at=_utc_now(),
    )


def _resolved_slime_profile(profile: UserProfile) -> SlimeProfile:
    """API-facing slime profile: always includes a fully merged persona (defaults if missing)."""
    if profile.slime_profile is None:
        base = _default_slime_profile()
    else:
        base = profile.slime_profile
    merged_persona = merge_slime_persona_defaults(base.persona)
    return base.model_copy(update={"persona": merged_persona})


@asynccontextmanager
async def _app_lifespan(_: FastAPI):
    if os.getenv("ASR_WARMUP_ON_START", "").strip().lower() in ("1", "true", "yes"):
        try:
            from foresight_x.voice.asr import warmup_asr_model

            warmup_asr_model()
        except Exception as e:
            _log.warning("ASR warmup skipped: %s", e)
    yield


app = FastAPI(title="Foresight-X API", version="0.1.0", lifespan=_app_lifespan)
_cors_settings = load_settings()
_exact_origins = _cors_settings.cors_origins_list or ["http://localhost:5173", "http://127.0.0.1:5173"]
_preview_regex = _cors_settings.cors_preview_regex or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_exact_origins,
    allow_origin_regex=_preview_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def supabase_jwt_context_middleware(request: Request, call_next):
    """Attach validated Supabase user to context; optionally enforce REQUIRE_AUTH on /api routes."""
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    settings = load_settings()
    auth_header = request.headers.get("authorization") or ""
    token: str | None = None
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip() or None

    user: dict[str, str | None] | None = None
    if token:
        try:
            user = decode_supabase_access_token(token)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            return JSONResponse(status_code=exc.status_code, content={"detail": detail})

    if settings.require_auth and path.startswith("/api") and not _auth_exempt_path(path):
        if user is None:
            return JSONResponse(status_code=401, content={"detail": "Missing bearer token"})

    ctx_tok = supabase_user_ctx_set(user)
    try:
        return await call_next(request)
    finally:
        supabase_user_ctx_reset(ctx_tok)


class RunRequest(BaseModel):
    raw_input: str = Field(min_length=1)
    #: Browser `new Date().toISOString()` — used to anchor action deadlines to the user's clock.
    client_now_iso: str | None = Field(default=None)
    #: Optional answers from the pre-run clarification modal (question_id → selected label).
    clarification_answers: dict[str, str] | None = Field(default=None)
    #: When true, append clarification lines to the persisted user profile priorities.
    save_clarification_to_profile: bool = Field(default=False)
    #: When true, skip query-enhancement rewrite and use user's raw input verbatim.
    preserve_raw_input: bool = Field(default=False)


class ExternalEventRequest(BaseModel):
    text: str = Field(min_length=1)
    event_type: str = Field(default="external_event", min_length=1)
    timestamp: str | None = Field(default=None)


class ClarifyRequest(BaseModel):
    raw_input: str = Field(min_length=1)
    thread_id: str | None = Field(default=None)
    recent_messages: list[dict[str, Any]] = Field(default_factory=list)
    # shadow_chat: skip clarify for jokes / obvious non-analytical lines (Decision mode unchanged).
    purpose: str | None = Field(default=None)


class ClarifySkipRequest(BaseModel):
    target_dimension: str = Field(min_length=1)
    question_prompt: str = Field(default="", max_length=900)


class SlimeConfirmCalendarBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start: str = Field(min_length=1)
    end: str = Field(min_length=1)
    description: str | None = Field(default=None, max_length=500)


class SlimeTtsBody(BaseModel):
    """Buddy auto-play: MP3 bytes for <audio> (avoids speechSynthesis gesture loss after async)."""

    text: str = Field(..., min_length=1, max_length=4096)


class RunResponse(BaseModel):
    trace: dict
    notes: list[str]
    trace_path: str


class ThreadCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    mode: Literal["shadow", "buddy", "reflect"] = "shadow"

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, v: Any) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


@app.get("/api/health")
def health() -> dict[str, str]:
    from foresight_x import __version__

    return {
        "status": "ok",
        "version": __version__,
        "api": "foresight-x",
    }


@app.get("/")
def root() -> dict[str, object]:
    return {
        "service": "Foresight-X API",
        "status": "ok",
        "routes": [
            "/api/health",
            "/api/me",
            "/api/threads",
            "/api/personas",
            "/api/personas/switch",
            "/api/run",
            "/api/run/stream",
            "/api/profile",
            "/api/profile/slime",
            "/api/slime/voice-command",
            "/api/slime/tts",
            "/api/slime/confirm-calendar-block",
            "/api/profile/priority-line/{line_id}",
            "/api/profile/memory-fact/{fact_id}",
            "/api/profile/tier3",
            "/api/clarify",
            "/api/traces",
            "/api/traces/{decision_id}",
            "/api/traces/{decision_id}/resource-drops",
            "/api/record-outcome",
            "/api/commit-decision",
            "/api/commits/{decision_id}",
            "/api/outcomes/{decision_id}",
            "/api/shadow/chat",
            "/api/option-chat",
            "/api/agility-preview",
            "/api/decision/agility-preview",
            "/api/decision/schedule",
            "/api/calendar/parse-ics",
            "/api/calendar/refine-schedule",
            "/api/calendar/events",
            "/api/calendar-agent/parse",
            "/api/calendar-agent/draft",
            "/api/calendar-agent/confirm",
            "/api/calendar-agent/alternatives",
            "/api/calendar-agent/from-report",
            "/api/calendar-agent/preferences",
            "/api/calendar-agent/export-ics",
            "/api/chat/unified",
            "/api/shadow-chat/threads",
            "/api/shadow-chat/threads/{thread_id}",
            "/api/shadow-chat/threads/{thread_id}/messages",
            "/api/shadow-chat/threads/{thread_id}/clarification-skip",
            "/api/shadow-chat/threads/{thread_id}/stream",
            "/api/shadow-chat/threads/{thread_id}/decision-report/stream",
            "/api/transcribe",
            "/api/personalization/ingest",
            "/api/memory-graph/external-event",
            "/api/diary/entries",
            "/api/diary/entries/{date}",
            "/api/diary/generate",
            "/api/diary/regenerate-cleaner",
            "/api/diary/sources/{date}",
            "/api/diary/entries/{entry_id}/save-insight",
        ],
    }


@app.get("/health")
def health_alias() -> dict[str, str]:
    return health()


@app.get("/api/me")
def api_me(user: dict[str, str | None] = Depends(get_current_user)) -> dict[str, str | None]:
    return {"id": user.get("id"), "email": user.get("email")}


@app.get("/api/threads")
def list_user_threads(user: dict[str, str | None] = Depends(get_current_user)) -> dict[str, list[dict[str, Any]]]:
    token = str(user.get("jwt") or "")
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        client = get_supabase_for_user(token)
        resp = (
            client.table("threads")
            .select("id,title,mode,created_at")
            .order("created_at", desc=True)
            .execute()
        )
        rows = resp.data if isinstance(resp.data, list) else []
        return {"threads": rows}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"threads_list_failed: {exc}") from exc


@app.post("/api/threads")
def create_user_thread(
    body: ThreadCreateRequest,
    user: dict[str, str | None] = Depends(get_current_user),
) -> dict[str, Any]:
    token = str(user.get("jwt") or "")
    user_id = str(user.get("id") or "")
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing sub")
    try:
        client = get_supabase_for_user(token)
        payload = {
            "user_id": user_id,
            "title": body.title,
            "mode": body.mode,
        }
        resp = client.table("threads").insert(payload).select("id,title,mode,created_at").execute()
        if isinstance(resp.data, list) and resp.data:
            return {"thread": resp.data[0]}
        if isinstance(resp.data, dict):
            return {"thread": resp.data}
        raise HTTPException(status_code=502, detail="threads_create_failed: invalid response")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"threads_create_failed: {exc}") from exc


@app.post("/api/memory-graph/external-event")
def add_external_event(body: ExternalEventRequest) -> dict:
    """Optional hook: append an external event into the temporal event DAG."""
    settings = _settings_for_active_user()
    if not settings.graph_enabled:
        return {"ok": False, "reason": "graph_disabled"}
    try:
        TemporalGraphMemory(settings.foresight_user_id, settings=settings).record_external_event(
            body.text.strip(),
            timestamp=body.timestamp,
            event_type=body.event_type.strip() or "external_event",
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"external_event_ingest_failed: {e!s}") from e


@app.get("/api/personas")
def list_personas() -> dict:
    ctx = get_supabase_user_for_request()
    if ctx and (ctx.get("id") or "").strip():
        uid = str(ctx["id"]).strip()
        return {"current_user_id": uid, "users": [{"user_id": uid, "created_at": ""}]}
    with _PERSONA_LOCK:
        reg = _ensure_registry()
    return reg.model_dump(mode="json")


@app.post("/api/personas")
def create_persona(body: PersonaCreateRequest) -> dict:
    if get_supabase_user_for_request():
        raise HTTPException(status_code=403, detail="persona_management_disabled_when_authenticated")
    uid = _validate_user_id_or_400(body.user_id)
    with _PERSONA_LOCK:
        reg = _ensure_registry()
        if any(x.user_id == uid for x in reg.users):
            raise HTTPException(status_code=409, detail="persona_exists")
        reg.users.append(PersonaItem(user_id=uid, created_at=_utc_now()))
        if not reg.current_user_id:
            reg.current_user_id = uid
        _save_registry(reg)
    ps = _persona_settings(uid)
    # Initialize empty profile files so the persona starts clean and visible.
    save_user_profile(UserProfile(user_id=uid), settings=ps)
    save_tier3_profile(load_tier3_empty_profile(uid))
    return {"ok": True, "current_user_id": reg.current_user_id, "created_user_id": uid}


@app.post("/api/personas/switch")
def switch_persona(body: PersonaSwitchRequest) -> dict:
    if get_supabase_user_for_request():
        raise HTTPException(status_code=403, detail="persona_management_disabled_when_authenticated")
    uid = _validate_user_id_or_400(body.user_id)
    with _PERSONA_LOCK:
        reg = _ensure_registry()
        if not any(x.user_id == uid for x in reg.users):
            raise HTTPException(status_code=404, detail="persona_not_found")
        reg.current_user_id = uid
        _save_registry(reg)
    return {"ok": True, "current_user_id": uid}


@app.delete("/api/personas/{user_id}")
def delete_persona(user_id: str) -> dict:
    if get_supabase_user_for_request():
        raise HTTPException(status_code=403, detail="persona_management_disabled_when_authenticated")
    uid = _validate_user_id_or_400(user_id)
    with _PERSONA_LOCK:
        reg = _ensure_registry()
        if not any(x.user_id == uid for x in reg.users):
            raise HTTPException(status_code=404, detail="persona_not_found")
        if len(reg.users) <= 1:
            raise HTTPException(status_code=400, detail="cannot_delete_last_persona")
        reg.users = [x for x in reg.users if x.user_id != uid]
        if reg.current_user_id == uid:
            reg.current_user_id = reg.users[0].user_id
        _save_registry(reg)
    _delete_persona_data(uid)
    return {"ok": True, "current_user_id": reg.current_user_id, "deleted_user_id": uid}


def _client_anchor_iso(client_now_iso: str | None) -> str | None:
    if not client_now_iso or not str(client_now_iso).strip():
        return None
    s = str(client_now_iso).strip()
    return s if len(s) >= 10 else None


@app.post("/api/run", response_model=RunResponse)
def run_decision(body: RunRequest) -> RunResponse:
    settings = _settings_for_active_user()
    ctx, notes = _build_context(settings)
    merge_done = False
    if body.clarification_answers:
        persist_clarification_followup(
            settings,
            thread=None,
            user_plain_message=body.raw_input.strip(),
            clarification_answers=body.clarification_answers,
            save_to_profile_requested=bool(body.save_clarification_to_profile),
            llm=ctx.llm,
        )
        merge_done = True
    trace = run_pipeline(
        ctx,
        body.raw_input.strip(),
        persist_trace=True,
        anchor_now_iso=_client_anchor_iso(body.client_now_iso),
        clarification_answers=body.clarification_answers,
        save_clarification_to_profile=body.save_clarification_to_profile,
        preserve_raw_input=body.preserve_raw_input,
        clarification_profile_merge_done_externally=merge_done,
    )
    trace_path = settings.traces_dir / f"{trace.decision_id}.json"
    return RunResponse(
        trace=trace.model_dump(mode="json"),
        notes=notes,
        trace_path=str(trace_path),
    )


@app.post("/api/run/stream")
def run_decision_stream(body: RunRequest) -> StreamingResponse:
    """SSE: notes, meta, per-stage ``partial`` payloads, then ``complete`` with full ``DecisionTrace``."""

    settings = _settings_for_active_user()
    ctx, notes = _build_context(settings)

    def gen():
        try:
            yield _sse_chunk({"event": "notes", "notes": notes})
            merge_done = False
            if body.clarification_answers:
                persist_clarification_followup(
                    settings,
                    thread=None,
                    user_plain_message=body.raw_input.strip(),
                    clarification_answers=body.clarification_answers,
                    save_to_profile_requested=bool(body.save_clarification_to_profile),
                    llm=ctx.llm,
                )
                merge_done = True
            for ev in iter_pipeline_events(
                ctx,
                body.raw_input.strip(),
                persist_trace=True,
                anchor_now_iso=_client_anchor_iso(body.client_now_iso),
                clarification_answers=body.clarification_answers,
                save_clarification_to_profile=body.save_clarification_to_profile,
                preserve_raw_input=body.preserve_raw_input,
                clarification_profile_merge_done_externally=merge_done,
            ):
                if ev.get("event") == "complete" and isinstance(ev.get("trace"), dict):
                    tid = ev["trace"].get("decision_id")
                    if isinstance(tid, str) and tid:
                        ev = {**ev, "trace_path": str(settings.traces_dir / f"{tid}.json")}
                yield _sse_chunk(ev)
        except Exception as e:
            # Without this, uvicorn closes the socket mid-chunk → browser ERR_INCOMPLETE_CHUNKED_ENCODING / "network error".
            yield _sse_chunk({"event": "error", "detail": f"{type(e).__name__}: {e!s}"})

    return _sse_streaming_response(gen())


@app.post("/run", response_model=RunResponse)
def run_decision_alias(body: RunRequest) -> RunResponse:
    return run_decision(body)


@app.get("/api/profile")
def get_profile() -> dict:
    settings = _settings_for_active_user()
    p = load_user_profile(settings).model_dump(mode="json")
    mfs = p.get("memory_facts") or []
    p["memory_facts"] = [x for x in mfs if (x or {}).get("status", "active") != "deprecated"]
    if not p.get("slime_profile"):
        p["slime_profile"] = _default_slime_profile().model_dump(mode="json")
    return p


@app.put("/api/profile")
def put_profile(body: UserProfile) -> dict:
    """Update user-editable profile fields; keeps system lines + clarification rows; replaces Profile-authored priorities."""
    settings = _settings_for_active_user()
    existing = load_user_profile(settings)
    existing = UserProfile.model_validate(existing.model_dump(mode="json"))
    stated_raw = body.user_priorities or body.priorities
    stated = list(stated_raw) if stated_raw else existing.profile_channel_priority_texts()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    system_lines = [x for x in existing.priority_lines if x.origin == "system"]
    clar_lines = [x for x in existing.priority_lines if x.origin == "user" and x.channel == "clarification"]
    by_text = {
        x.text.strip(): x
        for x in existing.priority_lines
        if x.origin == "user" and x.channel == "profile"
    }
    user_lines: list[ProfileLine] = []
    for t in stated:
        tt = t.strip()
        if not tt:
            continue
        old = by_text.get(tt)
        if old is not None:
            user_lines.append(old)
        else:
            user_lines.append(ProfileLine(id=str(uuid.uuid4()), text=tt, origin="user", channel="profile", created_at=ts))
    merged_lines = user_lines + clar_lines + system_lines
    u = [x.text for x in merged_lines if x.origin == "user"]
    i = [x.text for x in system_lines]
    merged = existing.model_copy(
        update={
            "priority_lines": merged_lines,
            "user_priorities": u,
            "priorities": u,
            "inferred_priorities": i,
            "about_me": body.about_me,
            "constraints": list(body.constraints),
            "values": list(body.values),
        }
    )
    path = save_user_profile(merged, settings=settings)
    return {"ok": True, "path": str(path)}


@app.get("/api/profile/slime")
def get_slime_profile() -> JSONResponse:
    from foresight_x.voice.slime_self_model import get_effective_slime_self_model

    settings = _settings_for_active_user()
    profile = load_user_profile(settings)
    body = _resolved_slime_profile(profile).model_dump(mode="json")
    uid = settings.foresight_user_id
    body["slime_self_model"] = get_effective_slime_self_model(uid, settings=settings).model_dump(mode="json")
    return JSONResponse(content=body, headers={"Cache-Control": "no-store, must-revalidate"})


@app.patch("/api/profile/slime")
def patch_slime_profile(body: dict[str, Any]) -> JSONResponse:
    from foresight_x.profile.slime_merge import merge_and_save_slime_profile

    settings = _settings_for_active_user()
    ok, err = merge_and_save_slime_profile(settings, dict(body or {}))
    if not ok:
        if err == "invalid_persona_patch":
            raise HTTPException(status_code=400, detail="invalid_slime_persona: invalid_persona_patch") from None
        raise HTTPException(status_code=400, detail=f"invalid_slime_profile_patch: {err}") from None
    profile = load_user_profile(settings)
    out = _resolved_slime_profile(profile)
    body_out = out.model_dump(mode="json")
    uid = settings.foresight_user_id
    from foresight_x.voice.slime_self_model import get_effective_slime_self_model

    body_out["slime_self_model"] = get_effective_slime_self_model(uid, settings=settings).model_dump(mode="json")
    return JSONResponse(
        content=body_out,
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


class SlimePersonaOnlyPatch(BaseModel):
    """PATCH /api/profile/slime-persona — same validation as nested persona on slime patch."""

    persona: dict[str, Any] = Field(default_factory=dict)


class SlimePersonaPreviewBody(BaseModel):
    persona: dict[str, Any] = Field(default_factory=dict)
    sample_context: Literal["decision", "memory", "calendar", "casual"] = "casual"
    slime_name: str | None = Field(default=None, max_length=24)


class _SlimePersonaPreviewLLMOut(BaseModel):
    preview_text: str


@app.get("/api/profile/slime-persona")
def get_slime_persona() -> JSONResponse:
    settings = _settings_for_active_user()
    profile = load_user_profile(settings)
    sp = _resolved_slime_profile(profile)
    return JSONResponse(
        content={"persona": sp.persona.model_dump(mode="json") if sp.persona else {}},
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


@app.patch("/api/profile/slime-persona")
def patch_slime_persona(body: dict[str, Any]) -> JSONResponse:
    settings = _settings_for_active_user()
    existing = load_user_profile(settings)
    try:
        parsed = SlimePersonaOnlyPatch.model_validate(body or {})
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"invalid_slime_persona_patch: {e.errors()}") from e
    stored = existing.slime_profile or _default_slime_profile()
    cur = merge_slime_persona_defaults(stored.persona)
    try:
        new_persona = merge_persona_patch(cur, parsed.persona)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"invalid_slime_persona: {e.errors()}") from e
    new_persona = new_persona.model_copy(update={"updated_at": _utc_now()})
    merged_stored = stored.model_copy(update={"persona": new_persona, "updated_at": _utc_now()})
    save_user_profile(existing.model_copy(update={"slime_profile": merged_stored}), settings=settings)
    return JSONResponse(
        content={"persona": merge_slime_persona_defaults(new_persona).model_dump(mode="json")},
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


def _deterministic_slime_preview(slime_name: str, persona: SlimePersona, sample_context: str) -> str:
    p = merge_slime_persona_defaults(persona)
    nick = (p.user_nickname or "you").strip() or "you"
    tone = p.tone.value if hasattr(p.tone, "value") else str(p.tone)
    if sample_context == "memory":
        seed = (
            f"{slime_name} (to {nick}): From what I’ve saved, it looks like that ties back to your priorities — "
            "I’m not totally certain without more detail, but the clues point that way."
        )
    elif sample_context == "calendar":
        seed = (
            f"{slime_name}: I found a slot that could work. I can add a short planning block there — "
            "want me to draft it so you can confirm?"
        )
    elif sample_context == "decision":
        seed = (
            f"{slime_name}: That sounds like a fork-in-the-road choice, not a quick fact check. "
            "I can switch on Decision Mode and structure it if you want."
        )
    else:
        seed = (
            f"{slime_name}: Quick take — pick the option that buys you room to learn without locking you in. "
            "If you want, we can pressure-test the downside next."
        )
    return f"[{tone}] {seed}"


@app.post("/api/profile/slime-persona/preview")
def slime_persona_preview(body: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = SlimePersonaPreviewBody.model_validate(body or {})
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"invalid_slime_persona_preview: {e.errors()}") from e
    name = (parsed.slime_name or "Mochi").strip()[:24] or "Mochi"
    merged = merge_persona_patch(merge_slime_persona_defaults(None), parsed.persona)
    preview_text = _deterministic_slime_preview(name, merged, parsed.sample_context)
    settings = _settings_for_active_user()
    if (settings.openai_api_key or "").strip():
        try:
            user_ref = (merged.user_nickname or "you").strip() or "you"
            prof_prev = load_user_profile(settings)
            pb = build_slime_persona_prompt(
                merged,
                f"preview:{parsed.sample_context}",
                slime_name=name,
                user_ref=user_ref,
                slime_profile_saved=prof_prev.slime_profile is not None,
            )
            samples = {
                "casual": "Give me a short recommendation.",
                "memory": "Who is Alex in my life?",
                "calendar": "Help me block time this weekend.",
                "decision": "What should I do about this offer?",
            }
            q = samples.get(parsed.sample_context, samples["casual"])
            prompt = (
                f"{pb}\n\nSample user line: {q}\n"
                "Write ONE short reply the slime would say (1–2 sentences), matching the persona. "
                "No markdown. Do not claim private memory facts unless hedging uncertainty."
            )
            llm = build_openai_llm(settings, temperature=0.55)
            out = structured_predict(llm, _SlimePersonaPreviewLLMOut, prompt)
            if (out.preview_text or "").strip():
                preview_text = out.preview_text.strip()[:500]
        except Exception:
            pass
    return {"preview_text": preview_text}


@app.delete("/api/profile/priority-line/{line_id}")
def delete_priority_line(line_id: str) -> dict:
    settings = _settings_for_active_user()
    existing = load_user_profile(settings)
    updated = delete_priority_line_by_id(existing, line_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="priority_line_not_found")
    path = save_user_profile(updated, settings=settings)
    return {"ok": True, "path": str(path)}


@app.delete("/api/profile/memory-fact/{fact_id}")
def delete_memory_fact(fact_id: str) -> dict:
    settings = _settings_for_active_user()
    existing = load_user_profile(settings)
    updated = delete_memory_fact_by_id(existing, fact_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="memory_fact_not_found")
    path = save_user_profile(updated, settings=settings)
    return {"ok": True, "path": str(path)}


@app.get("/api/profile/tier3")
def get_tier3_profile() -> dict:
    """Tier 3 profile consumed by the recommender prompt."""
    s = _settings_for_active_user()
    p = load_tier3_profile(s.foresight_user_id) or load_tier3_empty_profile(s.foresight_user_id)
    return {
        "profile": p.model_dump(mode="json"),
        "used_in_recommender": p.confidence >= 0.3,
        "use_threshold": 0.3,
        "source": "foresight_x.memory.profile_store",
    }


@app.post("/api/clarify")
def clarify(body: ClarifyRequest) -> dict:
    """Return optional multiple-choice questions before running the full pipeline."""
    settings = _settings_for_active_user()
    ctx, _notes = _build_context(settings)
    profile = load_user_profile(settings)
    recent = list(body.recent_messages or [])
    events: list[dict[str, Any]] = []
    thread: dict[str, Any] | None = None
    if body.thread_id:
        thread = load_thread(body.thread_id, user_id=settings.foresight_user_id)
        events = list(thread.get("clarification_events") or [])
        if not recent:
            recent = [
                {"role": str(m.get("role") or ""), "content": str(m.get("content") or "")}
                for m in (thread.get("messages") or [])[-8:]
            ]
    thread_meta: dict[str, Any]
    if thread is not None:
        thread_meta = thread
    else:
        thread_meta = {
            "messages": [{"role": str(x.get("role") or ""), "content": str(x.get("content") or "")} for x in recent],
            "clarification_events": events,
            "clarification_state": default_clarification_state(),
        }
    result = run_clarify_gate(
        body.raw_input.strip(),
        ctx.llm,
        profile=profile,
        recent_messages=[{"role": str(x.get("role") or ""), "content": str(x.get("content") or "")} for x in recent],
        thread_clarification_events=events,
        purpose=(body.purpose.strip() if (body.purpose or "").strip() else None),
        thread_metadata=thread_meta,
    )
    if result.need_clarification and thread is not None:
        for q in result.questions:
            append_clarification_event(
                thread,
                kind="asked",
                target_dimension=q.id,
                question_prompt=q.prompt,
            )
    return result.model_dump(mode="json")


@app.post("/api/shadow-chat/threads/{thread_id}/clarification-skip")
def shadow_clarification_skip(thread_id: str, body: ClarifySkipRequest) -> dict:
    """Record a skipped clarification so the gate does not immediately repeat the same dimension."""
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    thread = load_thread(thread_id, user_id=uid)
    append_clarification_event(
        thread,
        kind="skipped",
        target_dimension=body.target_dimension.strip(),
        question_prompt=body.question_prompt.strip(),
    )
    st = thread.setdefault("clarification_state", default_clarification_state())
    n_user = sum(1 for m in thread.get("messages", []) if str(m.get("role") or "") == "user")
    st["suppress_clarify_until_user_count"] = n_user + 8
    save_thread(thread)
    return {"ok": True, "thread": load_thread(thread_id, user_id=uid)}


@app.get("/api/traces")
def get_traces() -> list[dict]:
    settings = _settings_for_active_user()
    items = list_traces(settings=settings)
    # Keep newly created personas clean: hide legacy traces with unknown owner.
    if settings.foresight_user_id != "demo_user":
        out: list[dict] = []
        for t in items:
            try:
                tr = load_decision_trace(t.decision_id, settings=settings)
            except FileNotFoundError:
                continue
            owner = _trace_user_id(tr)
            if owner == settings.foresight_user_id:
                out.append(t.model_dump(mode="json"))
        return out
    return [t.model_dump(mode="json") for t in items]


@app.get("/api/outcomes/{decision_id}")
def get_outcome(decision_id: str) -> dict:
    """Return saved outcome JSON for ``decision_id``, or 404 if none."""
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="trace_not_found") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail="no_outcome")
    try:
        o = load_decision_outcome(decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="no_outcome") from None
    return o.model_dump(mode="json")


class ShadowMessage(BaseModel):
    role: str = Field(min_length=1)
    content: str = Field(min_length=1)


class ShadowChatRequest(BaseModel):
    messages: list[ShadowMessage] = Field(min_length=1)


class OptionChatRequest(BaseModel):
    decision_id: str = Field(min_length=1)
    option_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    chat_history: list[dict[str, str]] = Field(default_factory=list)


class OptionChatReply(BaseModel):
    answer: str = Field(
        description="Concrete answer grounded in the provided decision trace and selected option."
    )


class AgilityPreviewStep(BaseModel):
    title: str
    duration_minutes: int = Field(ge=15, le=8 * 60)
    deadline_hint: str | None = None


class AgilityPreviewRequest(BaseModel):
    decision_id: str = Field(min_length=1)
    selected_option_id: str = Field(min_length=1)


class AgilityPreviewResponse(BaseModel):
    summary: str
    likely_consequences: list[str]
    workload_impact: str
    schedule_constraints: list[str]
    risk_windows: list[str]
    first_steps: list[AgilityPreviewStep]
    review_checkpoint: str


class DecisionAgilityPreviewRequest(BaseModel):
    trace_id: str = Field(min_length=1)
    selected_option_id: str = Field(min_length=1)


class DecisionScheduleRequest(BaseModel):
    tasks: list[AlgoExecutionTask] = Field(default_factory=list)
    existing_events: list[AlgoCalendarEvent] = Field(default_factory=list)
    options: AlgoSchedulerOptions = Field(default_factory=AlgoSchedulerOptions)


class CalendarParseIcsRequest(BaseModel):
    ics_text: str = Field(min_length=1)


class CalendarRefineScheduleRequest(BaseModel):
    """Re-interpret natural-language schedule feedback and return a fresh AI placement."""

    feedback: str = Field(min_length=1, max_length=4000)
    tasks: list[AlgoExecutionTask] = Field(default_factory=list)
    existing_events: list[AlgoCalendarEvent] = Field(default_factory=list)
    options: AlgoSchedulerOptions | None = None
    #: When set, only these tasks are re-scheduled; caller should pin other AI blocks in existing_events.
    target_task_ids: list[str] | None = None


class CalendarAgentParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    thread_id: str | None = None
    decision_id: str | None = None
    current_event_id: str | None = None
    source: str = Field(default="shadow_chat", max_length=32)


class CalendarAgentDraftRequest(BaseModel):
    intent: dict[str, Any]
    tasks: list[dict[str, Any]] | None = None
    existing_events: list[dict[str, Any]] | None = None
    timezone: str = Field(default="UTC", max_length=80)


class CalendarAgentConfirmRequest(BaseModel):
    draft_id: str = Field(min_length=1)
    selected_event_ids: list[str] | None = None
    edits: list[dict[str, Any]] | None = None


class CalendarAgentAlternativesRequest(BaseModel):
    draft_id: str = Field(min_length=1)
    preference: str = Field(min_length=1)


class CalendarFromReportRequest(BaseModel):
    decision_id: str = Field(min_length=1)
    thread_id: str | None = None


class CalendarEventsReplaceRequest(BaseModel):
    events: list[dict[str, Any]] = Field(default_factory=list)


class CalendarEventPatchRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    start: str | None = None
    end: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    locked: bool | None = None


class UnifiedChatRequest(BaseModel):
    thread_id: str | None = None
    message: str = ""
    mode: str | None = None
    user_action: str = "send_message"
    recent_messages: list[dict] = Field(default_factory=list)


class ShadowThreadCreateRequest(BaseModel):
    title: str | None = None


class ShadowThreadMessageRequest(BaseModel):
    message: str = Field(min_length=1)
    mode: str | None = None
    user_action: str = "send_message"
    clarification_answers: dict[str, str] | None = Field(default=None)
    save_clarification_to_profile: bool = Field(default=False)
    #: Echoed on clarification SSE + done.metrics so the client can ignore stale async cards.
    client_turn_seq: int | None = None


class ShadowDecisionReportStreamRequest(BaseModel):
    decision_prompt: str = Field(min_length=1)
    recent_messages: list[dict] = Field(default_factory=list)
    clarification_answers: dict[str, str] | None = Field(default=None)
    save_clarification_to_profile: bool = Field(default=False)


class ShadowReportContextRequest(BaseModel):
    """Pinned decision report for revision follow-ups in Shadow Chat."""

    decision_id: str | None = None
    mode: str | None = "revision"


def _simple_chat_reply(message: str) -> str:
    text = message.strip()
    if not text:
        return "Tell me what is on your mind, and I will help you think it through."
    return (
        "I hear you. I can keep chatting normally, or help you structure this when you want. "
        f"You said: {text}"
    )


@app.post("/api/chat/unified")
def unified_chat(body: UnifiedChatRequest) -> dict:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    thread = load_thread(body.thread_id, user_id=uid)
    mode = str(body.mode or thread.get("mode") or "normal")
    action = (body.user_action or "send_message").strip()
    message = (body.message or "").strip()

    if action == "enter_role_mode":
        mode = "roleplay"
        thread["mode"] = mode
        save_thread(thread)
    elif action in {"exit_role_mode", "close_decision_report"}:
        mode = "normal"
        thread["mode"] = mode
        save_thread(thread)

    decision_trace: dict | None = None
    suggestion: dict | None = None
    profile_updates: list[str] = []
    shadow_updates: list[str] = []

    if message:
        append_message(thread, role="user", content=message, mode=mode)
        detection = detect_chat_mode_intent(
            user_message=message,
            recent_messages=body.recent_messages or thread.get("messages", [])[-8:],
        )
    else:
        detection = detect_chat_mode_intent(user_message="", recent_messages=[])

    if action == "dismiss_suggestion":
        ds = thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False})
        ds["role_mode"] = True
        ds["decision_report"] = True
        save_thread(thread)

    assistant_text = ""
    if action == "generate_decision_report":
        ctx, _ = _build_context(settings)
        trace = run_pipeline(ctx, message or "Help me decide.", persist_trace=True)
        decision_trace = trace.model_dump(mode="json")
        mode = "decision_report"
        thread["mode"] = mode
        append_message(
            thread,
            role="assistant",
            content="I generated a decision report. You can close it and keep chatting here.",
            mode=mode,
            decision_id=trace.decision_id,
        )
    elif mode == "roleplay":
        try:
            msgs = _slice_shadow_messages(thread)
            out = run_shadow_turn(
                msgs,
                settings=settings,
                thread_id=str(thread.get("thread_id") or "") or None,
                working_summary=str(thread.get("working_summary") or ""),
                temporary_context_prompt=format_temporary_context_prompt(thread),
            )
            assistant_text = out.reply.strip()
            append_temporary_context_items(thread, out.thread_only_items)
            rec = out.profile_record_texts
            if rec:
                profile_updates.extend(rec)
                shadow_updates.extend(rec)
        except Exception:
            assistant_text = _simple_chat_reply(message)
        append_message(thread, role="assistant", content=assistant_text, mode=mode)
        _finalize_shadow_thread_turn(thread, settings=settings)
    else:
        # Normal mode still uses the existing shadow engine as a passive memory-aware dialogue core,
        # but does not force users into explicit "ShadowChat page" navigation.
        try:
            msgs = _slice_shadow_messages(thread)
            out = run_shadow_turn(
                msgs,
                settings=settings,
                thread_id=str(thread.get("thread_id") or "") or None,
                working_summary=str(thread.get("working_summary") or ""),
                temporary_context_prompt=format_temporary_context_prompt(thread),
            )
            assistant_text = out.reply.strip()
            append_temporary_context_items(thread, out.thread_only_items)
            rec = out.profile_record_texts
            if rec:
                profile_updates.extend(rec)
                shadow_updates.extend(rec)
        except Exception:
            assistant_text = _simple_chat_reply(message)
        append_message(thread, role="assistant", content=assistant_text, mode=mode)
        _finalize_shadow_thread_turn(thread, settings=settings)
        passive_memory_enabled = os.getenv("ENABLE_UNIFIED_CHAT_PASSIVE_MEMORY", "false").strip().lower() == "true"
        if message and (settings.openai_api_key or "").strip() and passive_memory_enabled:
            try:
                _out = run_shadow_turn(
                    [{"role": "user", "content": message}],
                    settings=settings,
                )
                rec = _out.profile_record_texts
                if rec:
                    profile_updates.extend(rec)
                    shadow_updates.extend(rec)
            except Exception:
                pass

    ds = thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False})
    if action == "send_message" and message and not ds.get("role_mode", False) and detection.intent == "roleplay_candidate":
        suggestion = {
            "type": "role_mode",
            "title": "Enter Role Mode?",
            "message": "It looks like you may be starting a roleplay or simulation. Role Mode keeps the story state consistent while preserving this chat history.",
            "actions": ["enter_role_mode", "continue_normally", "dismiss_suggestion"],
        }
    elif action == "send_message" and message and not ds.get("decision_report", False) and detection.intent == "decision_candidate":
        suggestion = {
            "type": "decision_report",
            "title": "Turn this into a decision report?",
            "message": "I can structure this into options, trade-offs, risks, consequences, and an action plan.",
            "actions": ["generate_decision_report", "continue_normally"],
        }

    if action == "close_decision_report":
        append_message(
            thread,
            role="assistant",
            content="Decision report closed. We can keep chatting from here.",
            mode="normal",
        )

    thread = load_thread(thread["thread_id"], user_id=uid)
    return {
        "assistant_message": thread.get("messages", [])[-1] if thread.get("messages") else None,
        "mode": thread.get("mode", "normal"),
        "suggestion": suggestion,
        "decision_trace": decision_trace,
        "profile_updates": profile_updates,
        "shadow_updates": shadow_updates,
        "thread_id": thread["thread_id"],
        "messages": thread.get("messages", []),
    }


def _chunk_text(text: str, *, step: int = 18) -> list[str]:
    t = text or ""
    if not t:
        return []
    return [t[i : i + step] for i in range(0, len(t), step)]


def _slice_shadow_messages(thread: dict) -> list[dict]:
    """Last messages with metadata preserved so artifact rows can be filtered in Shadow."""
    raw = thread.get("messages") or []
    chunk = raw[-24:] if len(raw) > 24 else raw
    out: list[dict] = []
    for m in chunk:
        if not isinstance(m, dict):
            continue
        meta = m.get("metadata")
        row: dict = {"role": m.get("role"), "content": m.get("content")}
        if isinstance(meta, dict):
            row["metadata"] = meta
        out.append(row)
    return out


def _maybe_slime_buddy_turn_params(
    settings: Any,
    thread: dict[str, Any],
    *,
    intent_probe: str,
    chat_intent_label: str,
) -> dict[str, Any]:
    """Use Slime Buddy synthesis when this chat thread was created from Slime Voice."""
    if str(thread.get("source") or "") != "slime_voice":
        return {}
    eff = get_effective_slime_persona(settings)
    slime_lane = classify_slime_intent(intent_probe)
    slime_lane = merge_with_decision_intent(slime_lane, chat_intent_label == "decision_candidate")
    self_model = get_effective_slime_self_model(settings.foresight_user_id, settings=settings)
    identity_pack = build_slime_self_identity_prompt(self_model, eff.persona)
    style_pack = build_slime_persona_prompt(
        eff.persona,
        "shadow_chat",
        slime_name=eff.name,
        user_ref=eff.user_nickname_for_address,
        slime_profile_saved=eff.profile_saved,
    )
    addendum = f"{identity_pack}\n\n--- Persona style ---\n{style_pack}"
    hint = slime_lane.intent if slime_lane.intent != "general_chat" else None
    return {
        "slime_voice_style_addendum": addendum,
        "synthesis_frame": "slime_buddy",
        "slime_intent_hint": hint,
    }


def _finalize_shadow_thread_turn(thread: dict, *, settings: Any) -> None:
    """Persist rolling summary after messages appended."""
    maybe_update_thread_summary(thread, settings=settings)
    save_thread(thread)


def _should_store_profile_fact(item: str) -> bool:
    s = (item or "").strip()
    if len(s) < 8:
        return False
    lowered = s.lower()
    noisy = ["weather", "today", "just now", "lol", "haha"]
    if any(k in lowered for k in noisy):
        return False
    return True


def _build_shadow_suggestion(intent: str, *, dismissed: dict) -> dict | None:
    if intent == "roleplay_candidate" and not dismissed.get("role_mode", False):
        return {
            "type": "role_mode",
            "title": "Enter Role Mode?",
            "message": "It looks like you may be starting a roleplay or simulation. Role Mode keeps the story state consistent while preserving this chat history.",
            "actions": ["enter_role_mode", "continue_normally", "dismiss_suggestion"],
        }
    if intent == "decision_candidate" and not dismissed.get("decision_report", False):
        return {
            "type": "decision_report",
            "title": "Turn this into a decision report?",
            "message": "I can structure this into options, trade-offs, risks, consequences, and an action plan.",
            "actions": ["generate_decision_report", "continue_normally"],
        }
    return None


@app.get("/api/shadow-chat/threads")
def shadow_chat_threads() -> dict:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    return {"threads": list_threads(user_id=uid)}


@app.post("/api/shadow-chat/threads")
def create_shadow_chat_thread(body: ShadowThreadCreateRequest | None = None) -> dict:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    t = create_thread(user_id=uid, title=(body.title if body else None))
    return {"thread": t}


@app.get("/api/shadow-chat/threads/{thread_id}")
def get_shadow_chat_thread(thread_id: str) -> dict:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    t = load_thread(thread_id, user_id=uid)
    return {"thread": t}


@app.delete("/api/shadow-chat/threads/{thread_id}")
def remove_shadow_chat_thread(thread_id: str) -> dict:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    ok = delete_thread(user_id=uid, thread_id=thread_id)
    return {"ok": ok}


@app.post("/api/shadow-chat/threads/{thread_id}/report-context")
def set_shadow_report_context(thread_id: str, body: ShadowReportContextRequest) -> dict:
    """Pin or clear active decision report context for revision-style follow-ups."""
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    thread = load_thread(thread_id, user_id=uid)
    did = (body.decision_id or "").strip()
    if not did:
        thread.pop("active_report_context", None)
    else:
        thread["active_report_context"] = {
            "decision_id": did,
            "mode": (body.mode or "revision").strip() or "revision",
        }
    save_thread(thread)
    return {"ok": True, "thread": load_thread(thread_id, user_id=uid)}


@app.post("/api/shadow-chat/threads/{thread_id}/messages")
def post_shadow_chat_message(thread_id: str, body: ShadowThreadMessageRequest) -> dict:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    thread = load_thread(thread_id, user_id=uid)
    mode = str(body.mode or thread.get("mode") or "normal")
    msg = body.message.strip()
    effective_msg = merge_clarification_answers(msg, body.clarification_answers)
    if body.clarification_answers:
        try:
            ctx0, _ = _build_context(settings)
            persist_clarification_followup(
                settings,
                thread=thread,
                user_plain_message=msg,
                clarification_answers=body.clarification_answers,
                save_to_profile_requested=bool(body.save_clarification_to_profile),
                llm=ctx0.llm,
            )
        except Exception:
            _log.exception("persist_clarification_followup failed (non-stream) thread_id=%s", thread_id)
    intent_probe = effective_msg.strip() if effective_msg.strip() != msg.strip() else msg
    intent = detect_chat_intent(intent_probe, thread.get("messages", [])[-8:])
    if str(thread.get("source") or "") == "slime_voice" and body.user_action != "generate_decision_report":
        applied_nl, nl_reply = try_apply_slime_profile_from_chat_message(msg, settings=settings)
        if applied_nl and nl_reply:
            meta_extra = {"interaction_source": "slime_voice", "modality": "text"}
            append_message(
                thread,
                role="user",
                content=effective_msg,
                mode=mode,
                intent="slime_profile_chat_patch",
                metadata_extra=meta_extra,
            )
            append_message(
                thread,
                role="assistant",
                content=nl_reply,
                mode=mode,
                intent="slime_profile_chat_patch",
                memory_used=False,
                profile_updated=True,
            )
            _finalize_shadow_thread_turn(thread, settings=settings)
            refreshed = load_thread(thread_id, user_id=uid)
            return {
                "thread": refreshed,
                "suggestion": None,
                "decision_trace": None,
                "profile_updates": [],
                "thread_context_kept": False,
                "frontend_action": {"type": "slime_profile_refresh", "route": "", "payload": {}},
            }

    append_message(thread, role="user", content=effective_msg, mode=mode, intent=intent.intent)

    suggestion: dict | None = None
    decision_trace: dict | None = None
    profile_updates: list[str] = []
    thread_context_kept = False
    if body.user_action == "generate_decision_report":
        ctx, _ = _build_context(settings)
        trace = run_pipeline(
            ctx,
            effective_msg,
            persist_trace=True,
            clarification_answers=body.clarification_answers,
            save_clarification_to_profile=body.save_clarification_to_profile,
            clarification_profile_merge_done_externally=bool(body.clarification_answers),
        )
        decision_trace = trace.model_dump(mode="json")
        thread["mode"] = "decision_report"
        tr_dump = trace.model_dump(mode="json")
        append_message(
            thread,
            role="assistant",
            content="",
            mode="decision_report",
            decision_id=trace.decision_id,
            memory_used=True,
            metadata_extra={
                "type": "decision_report_artifact",
                "title": "Decision Report",
                "summary": _trace_artifact_summary(tr_dump if isinstance(tr_dump, dict) else {}),
                "created_at": _utc_now(),
                "status": "complete",
            },
        )
    else:
        msgs = _slice_shadow_messages(thread)
        ar_ctx = thread.get("active_report_context") or {}
        rev_id: str | None = None
        if isinstance(ar_ctx, dict) and str(ar_ctx.get("mode") or "") == "revision":
            d0 = str(ar_ctx.get("decision_id") or "").strip()
            if d0:
                rev_id = d0
        buddy_kw = _maybe_slime_buddy_turn_params(
            settings,
            thread,
            intent_probe=intent_probe,
            chat_intent_label=intent.intent,
        )
        out = run_shadow_turn(
            msgs,
            settings=settings,
            thread_id=str(thread.get("thread_id") or "") or None,
            report_revision_decision_id=rev_id,
            working_summary=str(thread.get("working_summary") or ""),
            temporary_context_prompt=format_temporary_context_prompt(thread),
            **buddy_kw,
        )
        append_temporary_context_items(thread, out.thread_only_items)
        thread_context_kept = bool(out.thread_only_items)
        profile_updates = [x for x in (out.profile_record_texts or []) if _should_store_profile_fact(x)]
        append_message(
            thread,
            role="assistant",
            content=out.reply.strip(),
            mode=mode,
            intent=intent.intent,
            memory_used=bool(out.used_memory_facts),
            profile_updated=bool(profile_updates),
        )
        if profile_updates:
            thread.setdefault("memory_events", []).append(
                {"kind": "profile_update", "items": profile_updates[:4], "at": _utc_now()}
            )
        _finalize_shadow_thread_turn(thread, settings=settings)
        suggestion = _build_shadow_suggestion(
            intent.intent,
            dismissed=thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False}),
        )
    refreshed = load_thread(thread_id, user_id=uid)
    return {
        "thread": refreshed,
        "suggestion": suggestion,
        "decision_trace": decision_trace,
        "profile_updates": profile_updates,
        "thread_context_kept": thread_context_kept,
    }


@app.post("/api/shadow-chat/threads/{thread_id}/stream")
def stream_shadow_chat_message(thread_id: str, body: ShadowThreadMessageRequest) -> StreamingResponse:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id

    def _gen():
        tid = thread_id
        try:
            thread = load_thread(thread_id, user_id=uid)
            tid = str(thread.get("thread_id") or thread_id)
            mode = str(body.mode or thread.get("mode") or "normal")
            message = body.message.strip()
            effective_message = merge_clarification_answers(message, body.clarification_answers)
            if body.clarification_answers:
                try:
                    ctx0, _ = _build_context(settings)
                    persist_clarification_followup(
                        settings,
                        thread=thread,
                        user_plain_message=message,
                        clarification_answers=body.clarification_answers,
                        save_to_profile_requested=bool(body.save_clarification_to_profile),
                        llm=ctx0.llm,
                    )
                except Exception:
                    _log.exception("persist_clarification_followup failed; continuing shadow reply thread_id=%s", tid)
            t0 = datetime.now(timezone.utc)
            intent_probe = (
                effective_message.strip()
                if effective_message.strip() != message.strip()
                else message
            )
            intent = detect_chat_intent(intent_probe, thread.get("messages", [])[-8:])
            retrieval_mode = "chat_deep" if intent.intent == "decision_candidate" else "chat_fast"

            if str(thread.get("source") or "") == "slime_voice" and body.user_action != "generate_decision_report":
                applied_nl, nl_reply = try_apply_slime_profile_from_chat_message(message, settings=settings)
                if applied_nl and nl_reply:
                    meta_extra = {"interaction_source": "slime_voice", "modality": "text"}
                    append_message(
                        thread,
                        role="user",
                        content=effective_message,
                        mode=mode,
                        intent="slime_profile_chat_patch",
                        metadata_extra=meta_extra,
                    )
                    append_message(
                        thread,
                        role="assistant",
                        content=nl_reply,
                        mode=mode,
                        intent="slime_profile_chat_patch",
                        memory_used=False,
                        profile_updated=True,
                    )
                    _finalize_shadow_thread_turn(thread, settings=settings)
                    yield _sse_chunk({"type": "status", "status": "responding", "label": "Updating Slime…"})
                    for chunk in _chunk_text(nl_reply):
                        yield _sse_chunk({"type": "delta", "content": chunk})
                    t_done = datetime.now(timezone.utc)
                    metrics = {
                        "first_ui_feedback_ms": 0,
                        "memory_retrieve_ms": 0,
                        "memory_cache_hit": True,
                        "intent_detect_ms": 1,
                        "response_first_token_ms": int((t_done - t0).total_seconds() * 1000),
                        "response_total_ms": int((t_done - t0).total_seconds() * 1000),
                        "profile_update_ms": 1,
                        "clarification_fast_gate_ms": 0.0,
                        "clarification_llm_ms": None,
                        "clarification_used_llm": False,
                        "clarification_shown": False,
                        "clarification_suppressed_reason": "slime_profile_nl_patch",
                        "client_turn_seq": body.client_turn_seq,
                    }
                    yield _sse_chunk(
                        {
                            "type": "done",
                            "thread_id": thread["thread_id"],
                            "message": thread.get("messages", [])[-1],
                            "suggestion": None,
                            "metrics": metrics,
                            "frontend_action": {"type": "slime_profile_refresh", "route": "", "payload": {}},
                        }
                    )
                    return

            user_row = append_message(thread, role="user", content=effective_message, mode=mode, intent=intent.intent)
            user_msg_id = str(user_row.get("id") or "")

            ctx, _ = _build_context(settings)
            profile = load_user_profile(settings)
            events = list(thread.get("clarification_events") or [])
            recent_slice = [
                {"role": str(m.get("role") or ""), "content": str(m.get("content") or "")}
                for m in thread.get("messages", [])[-12:]
            ]

            clar_metrics: dict[str, Any] = {
                "clarification_fast_gate_ms": 0.0,
                "clarification_llm_ms": None,
                "clarification_used_llm": False,
                "clarification_shown": False,
                "clarification_suppressed_reason": "",
                "client_turn_seq": body.client_turn_seq,
            }
            ex: ThreadPoolExecutor | None = None
            llm_future = None
            t_llm_start: float | None = None
            shown_clar = False
            fast = None
            if body.clarification_answers:
                clar_metrics["clarification_suppressed_reason"] = "inline_answers"
            else:
                t_fg = time.perf_counter()
                fast = should_show_clarification_fast(
                    effective_message,
                    recent_slice,
                    thread,
                    None,
                    interaction_purpose="shadow_chat",
                )
                clar_metrics["clarification_fast_gate_ms"] = fast_gate_timing_ms(t_fg)
                if not fast.should_ask:
                    clar_metrics["clarification_suppressed_reason"] = fast.reason
                elif fast.requires_llm and ctx.llm is not None:
                    clar_metrics["clarification_suppressed_reason"] = "pending_async_llm"
                    ex = ThreadPoolExecutor(max_workers=1)
                    t_llm_start = time.perf_counter()
                    llm_future = ex.submit(
                        run_personalized_clarify_gate,
                        effective_message,
                        ctx.llm,
                        profile=profile,
                        recent_messages=recent_slice,
                        thread_clarification_events=events,
                        interaction_purpose="shadow_chat",
                    )
                else:
                    clar_metrics["clarification_suppressed_reason"] = "pending_fast_template"

            yield _sse_chunk({"type": "status", "status": "reading_memory", "label": "Reading memory..."})
            yield _sse_chunk({"type": "status", "status": "thinking", "label": "Thinking..."})

            if fast is not None and fast.should_ask and fast.fast_question and not fast.requires_llm:
                qs_fast = build_fast_clarify_questions(fast)
                if qs_fast:
                    cmeta = {
                        "domain": fast.domain,
                        "target_dimension": fast.target_dimension,
                        "why_this_question": (
                            "Quick domain check so we don't guess what matters — no extra model round-trip."
                        ),
                        "fast_path": True,
                    }
                    yield _sse_chunk(
                        {
                            "type": "clarification",
                            "client_turn_seq": body.client_turn_seq,
                            "user_message_id": user_msg_id,
                            "need_clarification": True,
                            "questions": [q.model_dump(mode="json") for q in qs_fast],
                            "note": "",
                            "clarification_meta": {**cmeta, **clar_metrics},
                        }
                    )
                    for q in qs_fast:
                        append_clarification_event(
                            thread,
                            kind="asked",
                            target_dimension=q.id,
                            question_prompt=q.prompt,
                        )
                    shown_clar = True
                    clar_metrics["clarification_shown"] = True
                    clar_metrics["clarification_used_llm"] = False
                    clar_metrics["clarification_suppressed_reason"] = "none"

            suggestion = None
            profile_updates: list[str] = []
            if body.user_action == "generate_decision_report":
                if ex is not None:
                    ex.shutdown(wait=False, cancel_futures=True)
                ctx, _ = _build_context(settings)
                trace = run_pipeline(
                    ctx,
                    message,
                    persist_trace=True,
                    clarification_answers=body.clarification_answers,
                    save_clarification_to_profile=body.save_clarification_to_profile,
                    clarification_profile_merge_done_externally=bool(body.clarification_answers),
                )
                thread["mode"] = "decision_report"
                tr_dump = trace.model_dump(mode="json")
                append_message(
                    thread,
                    role="assistant",
                    content="",
                    mode="decision_report",
                    decision_id=trace.decision_id,
                    memory_used=True,
                    metadata_extra={
                        "type": "decision_report_artifact",
                        "title": "Decision Report",
                        "summary": _trace_artifact_summary(tr_dump if isinstance(tr_dump, dict) else {}),
                        "created_at": _utc_now(),
                        "status": "complete",
                    },
                )
                yield _sse_chunk({"type": "status", "status": "report_open", "label": "Decision report ready"})
                yield _sse_chunk(
                    {
                        "type": "done",
                        "thread_id": thread["thread_id"],
                        "message": thread.get("messages", [])[-1],
                        "decision_trace": trace.model_dump(mode="json"),
                    }
                )
                return

            msgs = _slice_shadow_messages(thread)
            ar_ctx = thread.get("active_report_context") or {}
            rev_id: str | None = None
            if isinstance(ar_ctx, dict) and str(ar_ctx.get("mode") or "") == "revision":
                d0 = str(ar_ctx.get("decision_id") or "").strip()
                if d0:
                    rev_id = d0
            buddy_kw = _maybe_slime_buddy_turn_params(
                settings,
                thread,
                intent_probe=intent_probe,
                chat_intent_label=intent.intent,
            )
            out = run_shadow_turn(
                msgs,
                settings=settings,
                thread_id=tid,
                retrieval_mode=retrieval_mode,
                report_revision_decision_id=rev_id,
                working_summary=str(thread.get("working_summary") or ""),
                temporary_context_prompt=format_temporary_context_prompt(thread),
                **buddy_kw,
            )
            append_temporary_context_items(thread, out.thread_only_items)
            t_after_reply = datetime.now(timezone.utc)
            text = out.reply.strip()
            yield _sse_chunk({"type": "status", "status": "responding", "label": "Writing response..."})
            for chunk in _chunk_text(text):
                yield _sse_chunk({"type": "delta", "content": chunk})
            profile_updates = [x for x in (out.profile_record_texts or []) if _should_store_profile_fact(x)]
            if profile_updates:
                yield _sse_chunk({"type": "status", "status": "updating_profile", "label": "Updating profile..."})
                yield _sse_chunk({"type": "profile_update", "items": profile_updates[:4]})
            elif out.thread_only_items and not out.memory_confirmation_question:
                yield _sse_chunk(
                    {
                        "type": "thread_context_note",
                        "message": "Keeping this in the current chat context",
                    }
                )
            append_message(
                thread,
                role="assistant",
                content=text,
                mode=mode,
                intent=intent.intent,
                memory_used=bool(out.used_memory_facts),
                profile_updated=bool(profile_updates),
            )
            if profile_updates:
                thread.setdefault("memory_events", []).append(
                    {"kind": "profile_update", "items": profile_updates[:4], "at": _utc_now()}
                )
            _finalize_shadow_thread_turn(thread, settings=settings)

            try:
                if (
                    not body.clarification_answers
                    and fast is not None
                    and fast.should_ask
                    and fast.requires_llm
                    and not shown_clar
                ):
                    llm_res = None
                    if llm_future is not None and t_llm_start is not None:
                        remaining = max(0.0, 1.5 - (time.perf_counter() - t_llm_start))
                        try:
                            llm_res = llm_future.result(timeout=remaining)
                        except FuturesTimeout:
                            llm_res = None
                        clar_metrics["clarification_llm_ms"] = round(
                            (time.perf_counter() - t_llm_start) * 1000.0, 3
                        )
                    else:
                        clar_metrics["clarification_llm_ms"] = None

                    last_uid = ""
                    for m in reversed(thread.get("messages", [])):
                        if str(m.get("role") or "") == "user":
                            last_uid = str(m.get("id") or "")
                            break
                    stale_clar = last_uid != user_msg_id

                    if not stale_clar:
                        if llm_res and llm_res.need_clarification and llm_res.questions:
                            mcomb = dict(llm_res.clarification_meta or {})
                            mcomb.update(clar_metrics)
                            yield _sse_chunk(
                                {
                                    "type": "clarification",
                                    "client_turn_seq": body.client_turn_seq,
                                    "user_message_id": user_msg_id,
                                    "need_clarification": True,
                                    "questions": [q.model_dump(mode="json") for q in llm_res.questions],
                                    "note": llm_res.note,
                                    "clarification_meta": mcomb,
                                }
                            )
                            for q in llm_res.questions:
                                append_clarification_event(
                                    thread,
                                    kind="asked",
                                    target_dimension=q.id,
                                    question_prompt=q.prompt,
                                )
                            clar_metrics["clarification_used_llm"] = True
                            clar_metrics["clarification_shown"] = True
                            clar_metrics["clarification_suppressed_reason"] = "none"
                        elif llm_future is not None and llm_res is None:
                            fb_qs = build_timeout_fallback_questions(heuristic_domain(effective_message))
                            dom = heuristic_domain(effective_message)
                            cmeta = {
                                "domain": dom,
                                "why_this_question": (
                                    "Smart clarification timed out — using a quick domain fallback instead."
                                ),
                                "fast_path": True,
                                "fallback_after_llm": True,
                                **clar_metrics,
                            }
                            yield _sse_chunk(
                                {
                                    "type": "clarification",
                                    "client_turn_seq": body.client_turn_seq,
                                    "user_message_id": user_msg_id,
                                    "need_clarification": True,
                                    "questions": [q.model_dump(mode="json") for q in fb_qs],
                                    "note": "",
                                    "clarification_meta": cmeta,
                                }
                            )
                            for q in fb_qs:
                                append_clarification_event(
                                    thread,
                                    kind="asked",
                                    target_dimension=q.id,
                                    question_prompt=q.prompt,
                                )
                            clar_metrics["clarification_shown"] = True
                            clar_metrics["clarification_suppressed_reason"] = "llm_timeout_fallback"
                        elif llm_future is None:
                            fb_qs = build_timeout_fallback_questions(heuristic_domain(effective_message))
                            dom = heuristic_domain(effective_message)
                            cmeta = {
                                "domain": dom,
                                "why_this_question": (
                                    "Smart clarification isn't available — quick domain fallback instead."
                                ),
                                "fast_path": True,
                                "fallback_after_llm": False,
                                **clar_metrics,
                            }
                            yield _sse_chunk(
                                {
                                    "type": "clarification",
                                    "client_turn_seq": body.client_turn_seq,
                                    "user_message_id": user_msg_id,
                                    "need_clarification": True,
                                    "questions": [q.model_dump(mode="json") for q in fb_qs],
                                    "note": "",
                                    "clarification_meta": cmeta,
                                }
                            )
                            for q in fb_qs:
                                append_clarification_event(
                                    thread,
                                    kind="asked",
                                    target_dimension=q.id,
                                    question_prompt=q.prompt,
                                )
                            clar_metrics["clarification_shown"] = True
                            clar_metrics["clarification_suppressed_reason"] = "no_llm_fallback"
                        elif llm_res is not None:
                            clar_metrics["clarification_shown"] = False
                            clar_metrics["clarification_suppressed_reason"] = str(llm_res.skip_reason or "not_needed")
                    else:
                        clar_metrics["clarification_suppressed_reason"] = "stale"
            finally:
                if ex is not None:
                    ex.shutdown(wait=False, cancel_futures=True)

            suggestion = _build_shadow_suggestion(
                intent.intent,
                dismissed=thread.setdefault("dismissed_suggestions", {"role_mode": False, "decision_report": False}),
            )
            if suggestion and suggestion.get("type") == "decision_report":
                yield _sse_chunk({"type": "status", "status": "decision_detected", "label": "Decision detected"})
                yield _sse_chunk({"type": "decision_suggestion", "suggestion": suggestion})
            elif suggestion and suggestion.get("type") == "role_mode":
                yield _sse_chunk({"type": "decision_suggestion", "suggestion": suggestion})
            t_done = datetime.now(timezone.utc)
            metrics = {
                "first_ui_feedback_ms": 0,
                "memory_retrieve_ms": int((t_after_reply - t0).total_seconds() * 1000),
                "memory_cache_hit": retrieval_mode == "chat_fast",
                "intent_detect_ms": 1,
                "response_first_token_ms": int((t_after_reply - t0).total_seconds() * 1000),
                "response_total_ms": int((t_done - t0).total_seconds() * 1000),
                "profile_update_ms": 0 if not profile_updates else 1,
                **clar_metrics,
            }
            yield _sse_chunk(
                {
                    "type": "done",
                    "thread_id": thread["thread_id"],
                    "message": thread.get("messages", [])[-1],
                    "suggestion": suggestion,
                    "metrics": metrics,
                }
            )
        except Exception as e:
            _log.exception("stream_shadow_chat_message failed thread_id=%s", thread_id)
            yield _sse_chunk({"type": "error", "message": str(e)})
            yield _sse_chunk(
                {
                    "type": "done",
                    "thread_id": tid,
                    "message": None,
                    "suggestion": None,
                    "metrics": {},
                    "stream_error": True,
                }
            )

    return _sse_streaming_response(_gen())


@app.post("/api/shadow-chat/threads/{thread_id}/decision-report/stream")
def stream_shadow_decision_report(thread_id: str, body: ShadowDecisionReportStreamRequest) -> StreamingResponse:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id

    def _gen():
        t0 = datetime.now(timezone.utc)
        tid = thread_id
        try:
            thread = load_thread(thread_id, user_id=uid)
            tid = str(thread.get("thread_id") or thread_id)
            ctx, _ = _build_context(settings)
            prompt = body.decision_prompt.strip()
            if body.clarification_answers:
                persist_clarification_followup(
                    settings,
                    thread=thread,
                    user_plain_message=prompt,
                    clarification_answers=body.clarification_answers,
                    save_to_profile_requested=bool(body.save_clarification_to_profile),
                    llm=ctx.llm,
                )
            first_meta_at: datetime | None = None
            for ev in iter_pipeline_events(
                ctx,
                prompt,
                persist_trace=True,
                clarification_answers=body.clarification_answers,
                save_clarification_to_profile=body.save_clarification_to_profile,
                clarification_profile_merge_done_externally=bool(body.clarification_answers),
            ):
                if ev.get("event") == "meta":
                    first_meta_at = datetime.now(timezone.utc)
                    yield _sse_chunk({"type": "status", "status": "report_generating", "label": "Structuring decision"})
                    yield _sse_chunk({"type": "report_event", "event": ev})
                    continue
                if ev.get("event") == "stage":
                    stage = str(ev.get("stage") or "")
                    label_map = {
                        "enhance": "Structuring decision",
                        "perceive": "Reading memory",
                        "retrieve": "Reading memory",
                        "infer": "Generating options",
                        "evaluate": "Evaluating trade-offs",
                        "simulate": "Simulating consequences",
                        "finalize": "Finalizing report",
                    }
                    yield _sse_chunk({"type": "status", "status": "report_generating", "label": label_map.get(stage, stage)})
                    yield _sse_chunk({"type": "report_event", "event": ev})
                    continue
                if ev.get("event") == "partial":
                    yield _sse_chunk({"type": "report_event", "event": ev})
                    continue
                if ev.get("event") == "complete":
                    trace = ev.get("trace")
                    did = str((trace or {}).get("decision_id") or "")
                    if did:
                        tr_dict = trace if isinstance(trace, dict) else {}
                        append_message(
                            thread,
                            role="assistant",
                            content="",
                            mode="decision_report",
                            decision_id=did,
                            memory_used=True,
                            metadata_extra={
                                "type": "decision_report_artifact",
                                "title": "Decision Report",
                                "summary": _trace_artifact_summary(tr_dict),
                                "created_at": _utc_now(),
                                "status": "complete",
                            },
                        )
                    t1 = datetime.now(timezone.utc)
                    yield _sse_chunk(
                        {
                            "type": "done",
                            "decision_trace": trace,
                            "decision_id": did,
                            "metrics": {
                                "report_stream_first_event_ms": int(((first_meta_at or t1) - t0).total_seconds() * 1000),
                                "report_total_ms": int((t1 - t0).total_seconds() * 1000),
                            },
                        }
                    )
                    return
            yield _sse_chunk({"type": "error", "message": "Pipeline ended without a complete report."})
            yield _sse_chunk(
                {
                    "type": "done",
                    "decision_trace": None,
                    "decision_id": "",
                    "metrics": {},
                    "stream_error": True,
                }
            )
        except Exception as e:
            _log.exception("stream_shadow_decision_report failed thread_id=%s", thread_id)
            yield _sse_chunk({"type": "error", "message": str(e)})
            yield _sse_chunk(
                {
                    "type": "done",
                    "decision_trace": None,
                    "decision_id": "",
                    "metrics": {},
                    "stream_error": True,
                }
            )

    return _sse_streaming_response(_gen())


class PersonalizationIngestRequest(BaseModel):
    text: str = Field(min_length=1)


@app.post("/api/personalization/ingest")
def personalization_ingest(body: PersonalizationIngestRequest) -> dict:
    """Analyze pasted/exported chat or email text; merge behavioral insights into UserProfile (+ Tier 3)."""
    settings = _settings_for_active_user()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Personalization ingest requires OPENAI_API_KEY")
    try:
        merged, ext, path = ingest_personalization_text(body.text.strip(), settings=settings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Personalization ingest failed: {e!s}") from e
    return {
        "ok": True,
        "profile_path": path,
        "summary_lines": preview_extract_summary(ext),
        "confidence": merged.confidence,
        "last_updated": merged.last_updated,
    }


@app.post("/api/shadow/chat")
def shadow_chat(body: ShadowChatRequest) -> dict:
    """Dialogue with the user's shadow self (not a therapist); no decisions. Updates shadow-self notes."""
    settings = _settings_for_active_user()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Shadow chat requires OPENAI_API_KEY")
    try:
        msgs = [m.model_dump() for m in body.messages]
        out = run_shadow_turn(msgs, settings=settings)
        reply = out.reply
        flag = out.suggest_decision_navigation
        state = out.state
        recorded_facts = out.profile_record_texts
        used_memory_facts = out.used_memory_facts
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Shadow chat failed: {e!s}") from e
    return {
        "reply": reply,
        "suggest_decision_navigation": flag,
        "shadow_turn_count": state.turn_count,
        "memory_facts_recorded": recorded_facts or [],
        "memory_used_facts": used_memory_facts,
        "recorded_observation": (" · ".join(recorded_facts) if recorded_facts else None),
        "thread_only_items": out.thread_only_items,
        "memory_confirmation_question": out.memory_confirmation_question,
    }


@app.post("/api/option-chat")
def option_chat(body: OptionChatRequest) -> dict:
    """Follow-up Q&A for one option card, grounded in the already-generated decision trace."""
    settings = _settings_for_active_user()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Option follow-up chat requires OPENAI_API_KEY")
    try:
        trace = load_decision_trace(body.decision_id.strip(), settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="trace_not_found") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail="trace_not_found")

    option = next((o for o in trace.options if o.option_id == body.option_id.strip()), None)
    if option is None:
        raise HTTPException(status_code=404, detail="option_not_found")

    futures = [f for f in trace.futures if f.option_id == option.option_id]
    future_bits: list[str] = []
    for f in futures[:2]:
        lines = [f"- horizon: {f.time_horizon}"]
        for s in f.scenarios[:4]:
            pct = int(round(float(s.probability) * 100))
            lines.append(f"  - {s.label} ({pct}%): {s.trajectory}")
        future_bits.append("\n".join(lines))
    future_block = "\n\n".join(future_bits) if future_bits else "(no scenario rows)"
    history_lines: list[str] = []
    for m in body.chat_history[-12:]:
        role = str(m.get("role", "")).strip().lower()
        content = str(m.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        label = "User" if role == "user" else "Coach"
        history_lines.append(f"{label}: {content}")
    history_block = "\n".join(history_lines) if history_lines else "(none)"

    llm = build_openai_llm(settings, temperature=0.42)
    prompt = (
        "You are an implementation copilot for a decision support app.\n"
        "Answer the user's follow-up about ONE selected option, grounded in this trace only.\n"
        "Output practical, specific guidance (steps, wording templates, sequencing, caveats).\n"
        "Do not re-rank all options unless asked; focus on helping execute this option well.\n"
        "Keep it concise (4-10 sentences). Use bullet points only if the user asks for a checklist.\n\n"
        f"Decision situation:\n{trace.user_state.raw_input}\n\n"
        f"Selected option ({option.option_id}):\n"
        f"- name: {option.name}\n"
        f"- description: {option.description}\n"
        f"- key assumptions: {option.key_assumptions}\n"
        f"- cost_of_reversal: {option.cost_of_reversal}\n\n"
        f"Recommendation rationale:\n{trace.recommendation.reasoning}\n\n"
        f"Simulated futures for this option:\n{future_block}\n\n"
        f"Follow-up chat history for this option:\n{history_block}\n\n"
        f"User follow-up question:\n{body.question.strip()}\n\n"
        "Return JSON with one field: answer."
    )
    try:
        out = structured_predict(llm, OptionChatReply, prompt)
        if isinstance(out, OptionChatReply):
            ans = out.answer.strip()
        else:
            ans = OptionChatReply.model_validate(out).answer.strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"option_chat_failed: {e!s}") from e
    return {"answer": ans, "decision_id": trace.decision_id, "option_id": option.option_id}


def _fallback_parse_ics(ics_text: str) -> list[dict]:
    events: list[dict] = []
    cur: dict[str, str] = {}
    in_event = False
    for raw in ics_text.splitlines():
        line = raw.strip()
        if line == "BEGIN:VEVENT":
            in_event = True
            cur = {}
            continue
        if line == "END:VEVENT":
            if cur.get("DTSTART") and cur.get("DTEND"):
                events.append(
                    {
                        "id": cur.get("UID") or f"upl-{len(events)+1}",
                        "title": cur.get("SUMMARY") or "Imported event",
                        "start": cur.get("DTSTART"),
                        "end": cur.get("DTEND"),
                        "source": "uploaded",
                        "description": cur.get("DESCRIPTION", ""),
                        "locked": True,
                    }
                )
            in_event = False
            cur = {}
            continue
        if not in_event or ":" not in line:
            continue
        k, v = line.split(":", 1)
        cur[k.split(";")[0]] = v.strip()
    return events


@app.post("/api/agility-preview")
def agility_preview(body: AgilityPreviewRequest) -> dict:
    """Structured consequence-focused preview for execution planning (no probability language in schema)."""
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(body.decision_id.strip(), settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="trace_not_found") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail="trace_not_found")

    selected = next((o for o in trace.options if o.option_id == body.selected_option_id.strip()), None)
    if selected is None:
        raise HTTPException(status_code=404, detail="option_not_found")

    next_actions = trace.recommendation.next_actions or []
    risk_labels = trace.rationality.detected_biases or []

    if not (settings.openai_api_key or "").strip():
        fallback = AgilityPreviewResponse(
            summary=(
                f'If you choose "{selected.name}", early progress depends on protecting focused blocks around existing commitments.'
            ),
            likely_consequences=[
                "Momentum grows when the first task is scheduled in the next 24 hours.",
                "Execution quality drops when tasks are fragmented into many small gaps.",
            ],
            workload_impact="Moderate compression in the first week; reserve focused windows to prevent spillover.",
            schedule_constraints=[
                "Protect at least one uninterrupted focus block per day.",
                "Leave a small buffer before hard deadlines.",
            ],
            risk_windows=[f"Watch for {x} under time pressure." for x in risk_labels[:2]]
            or ["Mid-week drift risk if no review checkpoint is scheduled."],
            first_steps=[
                AgilityPreviewStep(
                    title=(na.action or f"Execution step {i + 1}")[:140],
                    duration_minutes=60,
                    deadline_hint=na.deadline or None,
                )
                for i, na in enumerate(next_actions[:3])
            ]
            or [
                AgilityPreviewStep(title="Define first executable step and reserve a calendar block", duration_minutes=60),
                AgilityPreviewStep(title="Prepare required materials and dependencies", duration_minutes=45),
                AgilityPreviewStep(title="Run first review checkpoint and adjust schedule", duration_minutes=30),
            ],
            review_checkpoint="Run a 20-minute review in 72 hours: what moved, what slipped, what to reschedule.",
        )
        return fallback.model_dump(mode="json")

    llm = build_openai_llm(settings, temperature=0.45)
    prompt = (
        "You are an execution planning assistant.\n"
        "Return a structured agility preview after the user selected one option.\n"
        "Do NOT output numeric probability values or percentage language.\n"
        "Use concise, natural-language consequence preview.\n\n"
        f"Decision input:\n{trace.user_state.raw_input}\n\n"
        f"Selected option:\n- id: {selected.option_id}\n- name: {selected.name}\n- description: {selected.description}\n"
        f"- cost_of_reversal: {selected.cost_of_reversal}\n\n"
        f"Recommendation reasoning:\n{trace.recommendation.reasoning}\n\n"
        f"Detected risks:\n{risk_labels}\n\n"
        f"Existing next_actions:\n{[x.model_dump(mode='json') for x in next_actions]}\n\n"
        "Return JSON matching this schema:\n"
        "{summary, likely_consequences[], workload_impact, schedule_constraints[], risk_windows[], "
        "first_steps[{title,duration_minutes,deadline_hint}], review_checkpoint}"
    )
    try:
        out = structured_predict(llm, AgilityPreviewResponse, prompt)
        if isinstance(out, AgilityPreviewResponse):
            return out.model_dump(mode="json")
        return AgilityPreviewResponse.model_validate(out).model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"agility_preview_failed: {e!s}") from e


@app.post("/api/decision/agility-preview")
def decision_agility_preview(body: DecisionAgilityPreviewRequest) -> dict:
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(body.trace_id.strip(), settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="trace_not_found") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail="trace_not_found")

    graph = build_influence_graph_from_trace(trace)
    mcda = evaluate_options_mcda(graph.options, method="topsis")
    selected = next((o for o in graph.options if o.id == body.selected_option_id.strip()), None)
    if selected is None:
        raise HTTPException(status_code=404, detail="option_not_found")
    scenarios = generate_consequence_scenarios(selected, graph, trace=trace, n_scenarios=5)
    robust = evaluate_robustness(selected, scenarios, mcda_result=mcda)
    preview = build_agility_preview(selected.id, graph, mcda, robust, trace)
    return {
        "influence_graph": graph.model_dump(mode="json"),
        "mcda_result": mcda.model_dump(mode="json"),
        "robustness_result": robust.model_dump(mode="json"),
        "agility_preview": preview.model_dump(mode="json"),
    }


@app.post("/api/decision/schedule")
def decision_schedule(body: DecisionScheduleRequest) -> dict:
    result = schedule_with_ortools(body.tasks, body.existing_events, body.options)
    return result.model_dump(mode="json")


@app.post("/api/calendar/refine-schedule")
def calendar_refine_schedule(body: CalendarRefineScheduleRequest) -> dict:
    """Apply heuristic interpretation of user feedback, then re-run the same scheduler as /api/decision/schedule."""
    base = body.options or AlgoSchedulerOptions()
    opt, notes, tasks_filtered = interpret_calendar_feedback(body.feedback, base, list(body.tasks))
    raw_targets = [x.strip() for x in (body.target_task_ids or []) if x and str(x).strip()]
    if raw_targets:
        tid_set = set(raw_targets)
        tasks_to_place = [t for t in tasks_filtered if t.id in tid_set]
        if not tasks_to_place:
            notes = [
                *notes,
                "Selection did not match any remaining tasks after interpreting feedback — re-scheduling full backlog.",
            ]
            tasks_to_place = list(tasks_filtered)
        else:
            notes = [
                *notes,
                f"Re-scheduling only the selected block(s): {len(tasks_to_place)} task(s).",
            ]
    else:
        tasks_to_place = list(tasks_filtered)
    result = schedule_with_ortools(tasks_to_place, body.existing_events, opt)
    return {
        "interpretation": " ".join(notes),
        "notes": notes,
        "adjusted_options": opt.model_dump(),
        "tasks_input": [x.model_dump(mode="json") for x in tasks_filtered],
        "schedule": result.model_dump(mode="json"),
    }


@app.post("/api/calendar/parse-ics")
def parse_calendar_ics(body: CalendarParseIcsRequest) -> dict:
    text = body.ics_text.strip()
    try:
        from icalendar import Calendar  # type: ignore

        cal = Calendar.from_ical(text)
        events: list[dict] = []
        for comp in cal.walk():
            if comp.name != "VEVENT":
                continue
            dt_start = comp.get("dtstart")
            dt_end = comp.get("dtend")
            if not dt_start or not dt_end:
                continue
            start = dt_start.dt.isoformat()
            end = dt_end.dt.isoformat()
            events.append(
                {
                    "id": str(comp.get("uid") or f"upl-{len(events)+1}"),
                    "title": str(comp.get("summary") or "Imported event"),
                    "start": start,
                    "end": end,
                    "source": "uploaded",
                    "description": str(comp.get("description") or ""),
                    "locked": True,
                }
            )
        return {"events": events, "parser": "icalendar"}
    except Exception:
        return {"events": _fallback_parse_ics(text), "parser": "fallback"}


def _agent_calendar_source(val: str) -> AgentCalendarSource:
    v = (val or "manual").strip().lower()
    if v in ("slime_voice", "shadow_chat", "decision_report", "manual"):
        return v  # type: ignore[return-value]
    return "manual"


@app.get("/api/calendar/events")
def calendar_list_events() -> dict[str, Any]:
    settings = _settings_for_active_user()
    events = cal_agent_list_events(settings, settings.foresight_user_id)
    return {"events": [e.model_dump(mode="json") for e in events]}


@app.put("/api/calendar/events")
def calendar_replace_events(body: CalendarEventsReplaceRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    parsed: list[AgentCalendarEvent] = []
    for raw in body.events:
        try:
            parsed.append(AgentCalendarEvent.model_validate(raw))
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=f"invalid_event: {e!s}") from e
    cal_agent_replace_events(settings, settings.foresight_user_id, parsed)
    return {"ok": True, "count": len(parsed)}


@app.post("/api/calendar/events")
def calendar_create_event(body: dict[str, Any]) -> dict[str, Any]:
    settings = _settings_for_active_user()
    try:
        ev = AgentCalendarEvent.model_validate(body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"invalid_event: {e!s}") from e
    cal_agent_upsert_event(settings, settings.foresight_user_id, ev)
    return {"ok": True, "event": ev.model_dump(mode="json")}


@app.patch("/api/calendar/events/{event_id}")
def calendar_patch_event(event_id: str, body: CalendarEventPatchRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    events = cal_agent_list_events(settings, settings.foresight_user_id)
    match = next((e for e in events if e.id == event_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="event_not_found")
    patch = body.model_dump(exclude_none=True)
    data = match.model_dump()
    data.update(patch)
    try:
        updated = AgentCalendarEvent.model_validate(data)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    cal_agent_upsert_event(settings, settings.foresight_user_id, updated)
    return {"ok": True, "event": updated.model_dump(mode="json")}


@app.delete("/api/calendar/events/{event_id}")
def calendar_delete_event(event_id: str) -> dict[str, Any]:
    settings = _settings_for_active_user()
    ok = cal_agent_delete_event(settings, settings.foresight_user_id, event_id)
    if not ok:
        raise HTTPException(status_code=404, detail="event_not_found")
    return {"ok": True}


@app.post("/api/calendar-agent/parse")
def calendar_agent_parse(body: CalendarAgentParseRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    intent = parse_calendar_intent(
        body.text,
        {
            "thread_id": body.thread_id,
            "decision_id": body.decision_id,
            "current_event_id": body.current_event_id,
        },
        settings=settings,
        source=_agent_calendar_source(body.source),
    )
    return {"intent": intent.model_dump(mode="json")}


@app.post("/api/calendar-agent/draft")
def calendar_agent_draft(body: CalendarAgentDraftRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    try:
        intent = AgentCalendarIntent.model_validate(body.intent)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"invalid_intent: {e!s}") from e
    tasks: list[AgentCalendarTask] | None = None
    if body.tasks:
        tasks = []
        for t in body.tasks:
            tasks.append(AgentCalendarTask.model_validate(t))
    existing: list[AgentCalendarEvent] = []
    if body.existing_events:
        for e in body.existing_events:
            existing.append(AgentCalendarEvent.model_validate(e))
    else:
        existing = cal_agent_list_events(settings, uid)

    draft = build_draft_from_intent(
        intent,
        settings=settings,
        user_id=uid,
        existing_events=existing,
        tasks=tasks,
        user_timezone=body.timezone.strip() or "UTC",
        now=datetime.now(timezone.utc),
    )
    return {"draft": draft.model_dump(mode="json")}


@app.post("/api/calendar-agent/confirm")
def calendar_agent_confirm(body: CalendarAgentConfirmRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    confirmed, _prev = confirm_draft(
        settings=settings,
        user_id=settings.foresight_user_id,
        draft_id=body.draft_id.strip(),
        selected_event_ids=body.selected_event_ids,
        edits=body.edits,
    )
    if not confirmed:
        raise HTTPException(status_code=404, detail="draft_not_found")
    return {"ok": True, "events": [e.model_dump(mode="json") for e in confirmed]}


@app.post("/api/calendar-agent/alternatives")
def calendar_agent_alternatives(body: CalendarAgentAlternativesRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    alts = alternatives_for_draft(
        settings=settings,
        user_id=settings.foresight_user_id,
        draft_id=body.draft_id.strip(),
        preference=body.preference.strip().lower(),
    )
    return {"alternatives": [a.model_dump(mode="json") for a in alts]}


@app.post("/api/calendar-agent/from-report")
def calendar_agent_from_report(body: CalendarFromReportRequest) -> dict[str, Any]:
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(body.decision_id.strip(), settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="trace_not_found") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail="trace_not_found")
    existing = cal_agent_list_events(settings, settings.foresight_user_id)
    draft = draft_from_report(
        settings=settings,
        user_id=settings.foresight_user_id,
        decision_id=body.decision_id.strip(),
        thread_id=body.thread_id,
        existing_events=existing,
    )
    return {"draft": draft.model_dump(mode="json")}


@app.get("/api/calendar-agent/preferences")
def calendar_agent_preferences() -> dict[str, Any]:
    settings = _settings_for_active_user()
    pref = get_calendar_preferences(settings.foresight_user_id, load_user_profile(settings))
    return {"preferences": pref.model_dump(mode="json")}


@app.post("/api/calendar-agent/export-ics")
def calendar_agent_export_ics(body: dict[str, Any]) -> Response:
    raw_events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(raw_events, list):
        raise HTTPException(status_code=400, detail="events array required")
    text = cal_ics_service.events_to_ics(raw_events)
    return Response(content=text, media_type="text/calendar; charset=utf-8")


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)) -> dict:
    """Speech-to-text via OpenAI Whisper (same key as chat)."""
    settings = _settings_for_active_user()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Transcription requires OPENAI_API_KEY")
    try:
        from openai import OpenAI
    except ImportError as e:
        raise HTTPException(status_code=503, detail="openai package required for transcription") from e

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio file")

    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_api_base or None,
    )
    buf = io.BytesIO(raw)
    buf.name = file.filename or "audio.webm"
    try:
        tr = client.audio.transcriptions.create(model="whisper-1", file=buf)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e!s}") from e
    text = getattr(tr, "text", None) or ""
    return {"text": text.strip()}


def _run_slime_voice_pipeline(
    raw: bytes,
    filename: str | None,
    current_route: str | None,
    thread_id: str | None,
    slime_profile_s: str | None,
    recent_ui_s: str | None,
    settings,
) -> dict[str, Any]:
    from foresight_x.chat.conversation_service import (
        ensure_slime_voice_thread,
        maybe_slime_voice_preflight_reply,
        process_conversation_turn,
    )
    from foresight_x.chat.thread_store import append_message
    from foresight_x.shadow.thread_summary import maybe_update_thread_summary
    from foresight_x.voice.asr import transcribe_audio
    from foresight_x.voice.slime_voice_router import SlimeVoiceContext, route_slime_voice_command
    from foresight_x.voice.slime_tools import execute_slime_tool

    t_total0 = time.perf_counter()
    if not raw:
        raise ValueError("empty_audio")

    suffix = Path(filename or "rec.webm").suffix
    allowed = {".webm", ".wav", ".mp3", ".m4a", ".ogg", ".flac", ".mp4"}
    if not suffix or suffix.lower() not in allowed:
        suffix = ".webm"

    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        os.write(fd, raw)
    finally:
        os.close(fd)
    try:
        tr = transcribe_audio(tmp_path, settings=settings)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    transcript = (tr.text or "").strip()
    if not transcript:
        raise ValueError("no_speech_detected")

    uid = settings.foresight_user_id
    sp: dict[str, Any] = {}
    if slime_profile_s:
        try:
            raw_sp = json.loads(slime_profile_s)
            if isinstance(raw_sp, dict):
                sp = raw_sp
        except json.JSONDecodeError:
            sp = {}
    ruc: dict[str, Any] = {}
    if recent_ui_s:
        try:
            raw_r = json.loads(recent_ui_s)
            if isinstance(raw_r, dict):
                ruc = raw_r
        except json.JSONDecodeError:
            ruc = {}

    thread = ensure_slime_voice_thread(uid, thread_id)
    resolved_tid = str(thread.get("thread_id") or "")

    early_intent = ""
    early_tool = ""
    early_text: str | None = None
    preflight = maybe_slime_voice_preflight_reply(transcript, settings=settings)
    if preflight is not None:
        early_intent, early_text = preflight
        early_tool = early_intent

    if early_text is not None:
        assistant_text = early_text
        tr_timing_early = tr.timing or {}
        timing_identity: dict[str, Any] = {
            "audio_duration_seconds": tr.duration_seconds,
            "asr_provider": tr.provider,
            "asr_model": tr_timing_early.get("model"),
            "asr_model_load_ms": tr_timing_early.get("asr_model_load_ms"),
            "transcription_ms": tr_timing_early.get("transcription_ms"),
            "realtime_factor": tr_timing_early.get("realtime_factor"),
            "intent_route_ms": 0.0,
            "tool_execute_ms": 0.0,
            "total_ms": (time.perf_counter() - t_total0) * 1000,
        }
        append_message(
            thread,
            role="user",
            content=transcript,
            mode="normal",
            intent=early_intent,
            metadata_extra={"interaction_source": "slime_voice", "modality": "voice"},
        )
        append_message(
            thread,
            role="assistant",
            content=assistant_text,
            mode="normal",
            intent=early_intent,
            memory_used=False,
        )
        maybe_update_thread_summary(thread, settings=settings)
        voice_ui_id: dict[str, Any] = {
            "intent": early_intent,
            "memory_phases": [],
            "evidence_items": [],
            "should_show_evidence_drawer": False,
        }
        body_id: dict[str, Any] = {
            "transcript": transcript,
            "asr_provider": tr.provider,
            "language": tr.language,
            "assistant_text": assistant_text,
            "spoken_text": assistant_text,
            "spoken_sequence": [assistant_text],
            "thread_id": resolved_tid,
            "intent": early_intent,
            "decision_suggestion": None,
            "memory_updates": [],
            "tool_call": {"name": early_tool, "arguments": {}},
            "tool_result": {"ok": True, "early_handled": True, "handler": early_tool},
            "frontend_action": {"type": "none", "route": "", "payload": {}},
            "requires_confirmation": False,
            "timing": timing_identity,
            "voice_ui": voice_ui_id,
        }
        if os.getenv("SLIME_VOICE_DEBUG", "").strip().lower() in ("1", "true", "yes"):
            from foresight_x.voice.slime_identity import get_effective_slime_persona

            dbg_eff = get_effective_slime_persona(settings)
            un = dbg_eff.persona.user_nickname
            body_id["slime_persona_used"] = {
                "name": dbg_eff.name,
                "userNickname": un,
                "tone": dbg_eff.persona.tone.value,
                "replyLength": dbg_eff.persona.reply_length,
                "source": "profile_store",
            }
        return body_id

    ctx = SlimeVoiceContext(
        user_id=uid,
        current_route=current_route,
        thread_id=resolved_tid,
        slime_profile=sp,
        recent_ui_context=ruc,
    )
    t_route0 = time.perf_counter()
    route = route_slime_voice_command(transcript, ctx, settings=settings)
    route_ms = (time.perf_counter() - t_route0) * 1000

    tr_timing = tr.timing or {}
    timing: dict[str, Any] = {
        "audio_duration_seconds": tr.duration_seconds,
        "asr_provider": tr.provider,
        "asr_model": tr_timing.get("model"),
        "asr_model_load_ms": tr_timing.get("asr_model_load_ms"),
        "transcription_ms": tr_timing.get("transcription_ms"),
        "realtime_factor": tr_timing.get("realtime_factor"),
        "intent_route_ms": route_ms,
        "tool_execute_ms": 0.0,
        "total_ms": 0.0,
    }

    tool_executables = {
        "navigate",
        "search_memory",
        "create_calendar_draft",
        "schedule_decision_plan",
        "update_slime_profile",
        "open_shadow_chat",
    }
    if route.tool_name in tool_executables:
        t_tool0 = time.perf_counter()
        tool_result, fe, assistant_text = execute_slime_tool(
            route, ctx, settings=settings, transcript=transcript
        )
        tool_ms = (time.perf_counter() - t_tool0) * 1000
        timing["tool_execute_ms"] = tool_ms
        timing["total_ms"] = (time.perf_counter() - t_total0) * 1000

        append_message(
            thread,
            role="user",
            content=transcript,
            mode="normal",
            metadata_extra={"interaction_source": "slime_voice", "modality": "voice"},
        )
        append_message(
            thread,
            role="assistant",
            content=assistant_text,
            mode="normal",
            memory_used=route.tool_name == "search_memory",
        )
        maybe_update_thread_summary(thread, settings=settings)

        voice_ui: dict[str, Any] = {
            "intent": route.intent,
            "memory_phases": ["searching_memory", "synthesizing"] if route.tool_name == "search_memory" else [],
            "evidence_items": tool_result.get("evidence_items", []) if isinstance(tool_result, dict) else [],
            "should_show_evidence_drawer": (
                tool_result.get("should_show_evidence_drawer", False) if isinstance(tool_result, dict) else False
            ),
        }
        return {
            "transcript": transcript,
            "asr_provider": tr.provider,
            "language": tr.language,
            "assistant_text": assistant_text,
            "spoken_text": assistant_text,
            "spoken_sequence": [assistant_text],
            "thread_id": resolved_tid,
            "intent": route.intent,
            "decision_suggestion": None,
            "memory_updates": [],
            "tool_call": {"name": route.tool_name, "arguments": route.arguments},
            "tool_result": tool_result,
            "frontend_action": fe,
            "requires_confirmation": route.requires_confirmation,
            "timing": timing,
            "voice_ui": voice_ui,
        }

    t_conv0 = time.perf_counter()
    turn = process_conversation_turn(
        settings=settings,
        user_id=uid,
        thread=thread,
        user_message=transcript,
        source="slime_voice",
        modality="voice",
        clarification_answers=None,
    )
    timing["tool_execute_ms"] = (time.perf_counter() - t_conv0) * 1000
    timing["total_ms"] = (time.perf_counter() - t_total0) * 1000

    assistant_text = str(turn.get("assistant_text") or "")
    spoken_seq = [x for x in (turn.get("spoken_sequence") or []) if str(x).strip()]
    spoken_text = " ".join(spoken_seq).strip() or assistant_text
    ds = turn.get("decision_suggestion")
    fe_out = turn.get("frontend_action") or {"type": "none", "route": "", "payload": {}}

    voice_ui = {
        "intent": str(turn.get("intent") or route.intent),
        "memory_phases": [],
        "evidence_items": [],
        "should_show_evidence_drawer": False,
    }
    return {
        "transcript": transcript,
        "asr_provider": tr.provider,
        "language": tr.language,
        "assistant_text": assistant_text,
        "spoken_text": spoken_text,
        "spoken_sequence": spoken_seq,
        "thread_id": str(turn.get("thread_id") or resolved_tid),
        "intent": str(turn.get("intent") or route.intent),
        "decision_suggestion": ds,
        "memory_updates": turn.get("memory_updates") or [],
        "tool_call": {"name": route.tool_name, "arguments": route.arguments},
        "tool_result": {"ok": True, "conversation_turn": True},
        "frontend_action": fe_out,
        "requires_confirmation": bool(ds and ds.get("should_show")),
        "timing": timing,
        "voice_ui": voice_ui,
    }


@app.post("/api/slime/tts")
def slime_tts(body: SlimeTtsBody) -> Response:
    """Text → MP3 via OpenAI TTS. Used by Slime Buddy for auto-play after voice-command (browser-friendly)."""
    settings = _settings_for_active_user()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is required for server TTS (Slime Buddy auto-play).",
        )
    try:
        from openai import OpenAI
    except ImportError as e:
        raise HTTPException(status_code=503, detail="openai package required for TTS") from e

    text = body.text.strip()[:4096]
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_api_base or None)
    try:
        resp = client.audio.speech.create(model="tts-1", voice="alloy", input=text)
    except Exception as e:
        _log.exception("slime TTS OpenAI call failed")
        raise HTTPException(status_code=502, detail=f"TTS failed: {e!s}") from e

    try:
        audio_bytes = resp.read()
    except Exception:
        buf = io.BytesIO()
        resp.stream_to_file(buf)
        audio_bytes = buf.getvalue()
    if not audio_bytes:
        raise HTTPException(status_code=502, detail="TTS returned empty audio")
    return Response(content=audio_bytes, media_type="audio/mpeg")


@app.post("/api/slime/confirm-calendar-block")
def slime_confirm_calendar_block(body: SlimeConfirmCalendarBody) -> dict[str, Any]:
    """Validate voice-proposed times and return a normalized calendar event (client persists locally)."""
    try:
        datetime.fromisoformat(body.start.replace("Z", "+00:00"))
        datetime.fromisoformat(body.end.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid_datetimes: {e!s}") from e
    eid = f"voice-{uuid.uuid4().hex[:12]}"
    return {
        "ok": True,
        "event": {
            "id": eid,
            "title": body.title.strip()[:200],
            "start": body.start,
            "end": body.end,
            "source": "manual",
            "description": (body.description or "")[:500],
            "locked": False,
        },
    }


@app.post("/api/slime/voice-command")
async def slime_voice_command(
    audio: UploadFile = File(...),
    current_route: str | None = Form(None),
    thread_id: str | None = Form(None),
    slime_profile: str | None = Form(None),
    recent_ui_context: str | None = Form(None),
) -> JSONResponse:
    """Push-to-talk: local ASR (default faster-whisper) + GPT-4o-mini tool routing."""
    settings = _settings_for_active_user()
    raw = await audio.read()
    try:
        body = await asyncio.to_thread(
            _run_slime_voice_pipeline,
            raw,
            audio.filename,
            current_route,
            thread_id,
            slime_profile,
            recent_ui_context,
            settings,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except ModuleNotFoundError as e:
        _log.exception("slime voice command missing dependency")
        raise HTTPException(
            status_code=422,
            detail=(
                f"Missing Python dependency: {e!s}. Install web extras from the repo root: "
                "pip install -e '.[web]'"
            ),
        ) from e
    except Exception as e:
        _log.exception("slime voice command failed")
        raise HTTPException(status_code=500, detail=f"voice_command_failed: {e!s}") from e
    return JSONResponse(content=body)


@app.get("/api/traces/{decision_id}/resource-drops")
def get_trace_resource_drops(decision_id: str) -> dict:
    """Post-hoc resource suggestions (does not block pipeline); Tavily optional."""
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}")
    try:
        drops = generate_resource_drops_for_recommendation(trace, settings=settings)
    except Exception:
        drops = calendar_fallback_drops(trace, recommendation=None)
    return {"resource_drops": resource_drops_as_json(drops)}


@app.get("/api/traces/{decision_id}")
def get_trace(decision_id: str) -> dict:
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}")
    return trace.model_dump(mode="json")


@app.delete("/api/traces/{decision_id}")
def remove_trace(decision_id: str) -> dict:
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}")
    try:
        trace_deleted, outcome_deleted, commit_deleted = delete_trace(decision_id, settings=settings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "trace_deleted": trace_deleted,
        "outcome_deleted": outcome_deleted,
        "commit_deleted": commit_deleted,
    }


_RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_MONTH = re.compile(r"^\d{4}-\d{2}$")


class DiaryGenerateBody(BaseModel):
    date: str = Field(min_length=10, max_length=10)
    force: bool = False
    timezone: str = Field(default="UTC", max_length=80)


class DiaryRegenerateCleanBody(BaseModel):
    date: str = Field(min_length=10, max_length=10)
    timezone: str = Field(default="UTC", max_length=80)
    confirm_replace: bool = False


class DiarySaveInsightBody(BaseModel):
    insight_text: str = Field(min_length=1, max_length=500)
    confirmed: bool = False


@app.get("/api/diary/entries")
def diary_entries_month(month: str, timezone: str = "UTC") -> dict:
    """Summaries for each day in ``month`` (YYYY-MM) for timeline nodes."""
    if not _RE_MONTH.match((month or "").strip()):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    try:
        rows = list_month_summaries(settings, uid, month.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "month": month.strip(),
        "timezone": (timezone or "UTC").strip() or "UTC",
        "days": [r.model_dump(mode="json") for r in rows],
    }


@app.get("/api/diary/entries/{date}")
def diary_entry_by_date(date: str) -> dict:
    if not _RE_DATE.match((date or "").strip()):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    entry = load_entry(settings, uid, date.strip())
    if entry is None:
        raise HTTPException(status_code=404, detail="diary_not_found")
    return entry.model_dump(mode="json")


@app.get("/api/diary/sources/{date}")
def diary_sources(date: str, timezone: str = "UTC") -> dict:
    if not _RE_DATE.match((date or "").strip()):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    tz = (timezone or "UTC").strip() or "UTC"
    bundle = collect_diary_sources_for_date(uid, date.strip(), tz, settings=settings)
    refs = bundle.source_refs
    return {
        "date": bundle.date,
        "timezone": tz,
        "source_counts": bundle.counts().model_dump(),
        "source_diagnostics": bundle.diagnostics.model_dump(mode="json"),
        "thread_refs": [{"thread_id": tid} for tid in refs.thread_ids],
        "message_refs": [{"message_id": mid} for mid in refs.message_ids[:200]],
        "decision_refs": [{"decision_id": d} for d in refs.decision_ids],
        "calendar_event_refs": [{"event_id": e} for e in refs.calendar_event_ids],
        "calendar_draft_refs": [{"draft_id": d} for d in refs.calendar_draft_ids],
        "memory_refs": [{"memory_id": m} for m in refs.memory_ids],
        "import_refs": [{"import_id": i} for i in refs.import_ids],
    }


@app.post("/api/diary/generate")
def diary_generate(body: DiaryGenerateBody) -> dict:
    if not _RE_DATE.match((body.date or "").strip()):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    tz = (body.timezone or "UTC").strip() or "UTC"
    bundle = collect_diary_sources_for_date(uid, body.date.strip(), tz, settings=settings)

    if not bundle_has_activity(bundle) and not body.force:
        return {
            "ok": True,
            "empty": True,
            "message": "no_meaningful_activity",
            "source_diagnostics": bundle.diagnostics.model_dump(mode="json"),
        }

    existing = load_entry(settings, uid, body.date.strip())
    if existing is not None and not body.force:
        return {"ok": True, "cached": True, "entry": existing.model_dump(mode="json")}

    entry = generate_diary_entry(uid, bundle, settings=settings)
    if entry is None:
        return {
            "ok": True,
            "empty": True,
            "message": "no_meaningful_activity",
            "source_diagnostics": bundle.diagnostics.model_dump(mode="json"),
        }

    created_new = existing is None
    if existing is not None:
        entry = entry.model_copy(
            update={
                "id": existing.id,
                "created_at": existing.created_at,
                "user_edited": existing.user_edited,
                "memory_status": existing.memory_status,
            }
        )
    entry = attach_links(entry, bundle)
    save_entry(settings, uid, stamp_times(entry, created=created_new))
    loaded = load_entry(settings, uid, body.date.strip())
    return {"ok": True, "empty": False, "entry": (loaded or entry).model_dump(mode="json")}


@app.post("/api/diary/regenerate-cleaner")
def diary_regenerate_cleaner(body: DiaryRegenerateCleanBody) -> dict:
    """Re-run noise filter + two-stage diary writer; replace stored entry unless user_edited blocks."""
    if not _RE_DATE.match((body.date or "").strip()):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    tz = (body.timezone or "UTC").strip() or "UTC"
    existing = load_entry(settings, uid, body.date.strip())
    if existing is not None and existing.user_edited and not body.confirm_replace:
        raise HTTPException(status_code=409, detail="user_edited_confirmation_required")

    bundle = collect_diary_sources_for_date(uid, body.date.strip(), tz, settings=settings)
    if not bundle_has_activity(bundle):
        return {
            "ok": True,
            "empty": True,
            "message": "no_meaningful_activity",
            "source_diagnostics": bundle.diagnostics.model_dump(mode="json"),
        }

    entry = generate_diary_entry(uid, bundle, settings=settings)
    if entry is None:
        return {
            "ok": True,
            "empty": True,
            "message": "no_meaningful_activity",
            "source_diagnostics": bundle.diagnostics.model_dump(mode="json"),
        }

    created_new = existing is None
    if existing is not None:
        entry = entry.model_copy(
            update={
                "id": existing.id,
                "created_at": existing.created_at,
                "user_edited": existing.user_edited,
                "memory_status": existing.memory_status,
            }
        )
    entry = attach_links(entry, bundle)
    save_entry(settings, uid, stamp_times(entry, created=created_new))
    loaded = load_entry(settings, uid, body.date.strip())
    return {"ok": True, "empty": False, "entry": (loaded or entry).model_dump(mode="json")}


@app.post("/api/diary/entries/{entry_id}/save-insight")
def diary_save_insight(entry_id: str, body: DiarySaveInsightBody) -> dict:
    if not body.confirmed:
        raise HTTPException(status_code=400, detail="confirmation_required")
    insight = body.insight_text.strip()
    if not insight:
        raise HTTPException(status_code=400, detail="empty_insight")
    settings = _settings_for_active_user()
    uid = settings.foresight_user_id
    entry = load_entry_by_id(settings, uid, entry_id.strip())
    if entry is None:
        raise HTTPException(status_code=404, detail="diary_not_found")

    fact = ProfileMemoryFact(
        id=str(uuid.uuid4()),
        category=MemoryFactCategory.GOALS,
        text=insight[:500],
        source="user",
        evidence=f"From diary entry {entry.id} ({entry.date})",
        qualifiers={"diary_entry_id": entry.id},
    )
    profile = load_user_profile(settings)
    updated_profile = append_profile_memory_records(profile, [fact])
    save_user_profile(updated_profile, settings=settings)

    next_entry = entry.model_copy(update={"memory_status": "saved_selected_insights"})
    save_entry(settings, uid, stamp_times(next_entry, created=False))
    return {"ok": True, "memory_fact_id": fact.id, "diary_entry_id": entry.id}


class RecordOutcomeRequest(BaseModel):
    decision_id: str = Field(min_length=1)
    user_took_recommended_action: bool
    actual_outcome: str = Field(min_length=1)
    user_reported_quality: int = Field(ge=1, le=5)
    reversed_later: bool


class RecordOutcomeResponse(BaseModel):
    ok: bool
    outcome_path: str
    evaluation_log_appended: bool = False


class CommitDecisionRequest(BaseModel):
    decision_id: str = Field(min_length=1)
    chosen_option_id: str = Field(min_length=1)


class CommitDecisionResponse(BaseModel):
    ok: bool
    commit_path: str


@app.post("/api/commit-decision", response_model=CommitDecisionResponse)
def commit_decision(body: CommitDecisionRequest) -> CommitDecisionResponse:
    """Record which option the user adopts (before or without outcome)."""
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(body.decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found for decision_id={body.decision_id}") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail=f"Trace not found for decision_id={body.decision_id}")
    valid_ids = {o.option_id for o in trace.options}
    if body.chosen_option_id not in valid_ids:
        raise HTTPException(
            status_code=400,
            detail=f"chosen_option_id must be one of the trace options: {sorted(valid_ids)}",
        )
    rec_id = trace.recommendation.chosen_option_id
    matches = bool(rec_id and body.chosen_option_id == rec_id)
    commit = DecisionCommit(
        decision_id=body.decision_id,
        chosen_option_id=body.chosen_option_id,
        matches_recommendation=matches,
        committed_at=_utc_now(),
    )
    path = save_commit(commit, settings=settings)
    return CommitDecisionResponse(ok=True, commit_path=str(path))


@app.get("/api/commits/{decision_id}")
def get_commit(decision_id: str) -> dict:
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="no_commit") from None
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail="no_commit")
    c = load_commit(decision_id, settings=settings)
    if c is None:
        raise HTTPException(status_code=404, detail="no_commit")
    return c.model_dump(mode="json")


@app.post("/api/record-outcome", response_model=RecordOutcomeResponse)
def record_outcome(body: RecordOutcomeRequest) -> RecordOutcomeResponse:
    settings = _settings_for_active_user()
    try:
        trace = load_decision_trace(body.decision_id, settings=settings)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found for decision_id={body.decision_id}")
    trace_user = _trace_user_id(trace)
    if not _trace_visible_to_current(trace_user, settings.foresight_user_id):
        raise HTTPException(status_code=404, detail=f"Trace not found for decision_id={body.decision_id}")
    outcome = DecisionOutcome(
        decision_id=body.decision_id,
        user_took_recommended_action=body.user_took_recommended_action,
        actual_outcome=body.actual_outcome.strip(),
        user_reported_quality=body.user_reported_quality,
        reversed_later=body.reversed_later,
        timestamp=_utc_now(),
    )
    path = save_decision_outcome(outcome, settings=settings)
    apply_outcome_to_memory(body.decision_id, outcome, settings=settings)
    eval_appended = False
    try:
        commit = load_commit(body.decision_id, settings=settings)
        row = build_evaluation_record(trace, outcome, commit=commit)
        append_evaluation_log(row, settings=settings)
        eval_appended = True
    except Exception as exc:
        _log.warning("evaluation_log append failed for %s: %s", body.decision_id, exc)
    return RecordOutcomeResponse(ok=True, outcome_path=str(path), evaluation_log_appended=eval_appended)


@app.post("/record-outcome", response_model=RecordOutcomeResponse)
def record_outcome_alias(body: RecordOutcomeRequest) -> RecordOutcomeResponse:
    return record_outcome(body)
