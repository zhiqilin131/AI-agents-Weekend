"""FastAPI server for the Foresight-X web UI (Vite dev proxy → /api/*)."""

from __future__ import annotations

import os
from typing import Any
import json
import uuid
from datetime import datetime, timezone

import io
import logging
import re
from pathlib import Path
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
import time

import chromadb
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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
    delete_memory_fact_by_id,
    delete_priority_line_by_id,
)
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import DecisionCommit, DecisionOutcome, ProfileLine, UserProfile
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


def _active_user_id(settings=None) -> str:
    reg = _ensure_registry(settings)
    uid = (reg.current_user_id or "").strip()
    return uid or _default_user_id(settings)


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


app = FastAPI(title="Foresight-X API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class RunResponse(BaseModel):
    trace: dict
    notes: list[str]
    trace_path: str


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
            "/api/personas",
            "/api/personas/switch",
            "/api/run",
            "/api/run/stream",
            "/api/profile",
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
        ],
    }


@app.get("/health")
def health_alias() -> dict[str, str]:
    return health()


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
    with _PERSONA_LOCK:
        reg = _ensure_registry()
    return reg.model_dump(mode="json")


@app.post("/api/personas")
def create_persona(body: PersonaCreateRequest) -> dict:
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
        out = run_shadow_turn(
            msgs,
            settings=settings,
            thread_id=str(thread.get("thread_id") or "") or None,
            report_revision_decision_id=rev_id,
            working_summary=str(thread.get("working_summary") or ""),
            temporary_context_prompt=format_temporary_context_prompt(thread),
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
            out = run_shadow_turn(
                msgs,
                settings=settings,
                thread_id=tid,
                retrieval_mode=retrieval_mode,
                report_revision_decision_id=rev_id,
                working_summary=str(thread.get("working_summary") or ""),
                temporary_context_prompt=format_temporary_context_prompt(thread),
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
