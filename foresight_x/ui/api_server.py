"""FastAPI server for the Foresight-X web UI (Vite dev proxy → /api/*)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import io
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from foresight_x.config import load_settings
from foresight_x.harness.improvement_loop import apply_outcome_to_memory
from foresight_x.harness.outcome_tracker import load_decision_outcome, save_decision_outcome
from foresight_x.harness.trace import load_decision_trace
from foresight_x.harness.decision_commit import load_commit, save_commit
from foresight_x.harness.evaluation_log import append_evaluation_log, build_evaluation_record
from foresight_x.harness.trace_index import delete_trace, list_traces
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.orchestration.pipeline import PipelineContext, iter_pipeline_events, run_pipeline
from foresight_x.perception.clarify_gate import run_clarify_gate
from foresight_x.profile.merge import delete_memory_fact_by_id, delete_priority_line_by_id
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import DecisionCommit, DecisionOutcome, ProfileLine, UserProfile
from foresight_x.ui.cli import _build_context
from foresight_x.memory.profile_store import empty_profile as load_tier3_empty_profile
from foresight_x.memory.profile_store import load_profile as load_tier3_profile
from foresight_x.personalization.ingest import ingest_personalization_text, preview_extract_summary
from foresight_x.shadow.chat import run_shadow_turn
from foresight_x.structured_predict import structured_predict


_log = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sse_chunk(obj: dict) -> str:
    """SSE line; ``default=str`` avoids rare non-JSON-native values aborting the stream."""
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


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


class ClarifyRequest(BaseModel):
    raw_input: str = Field(min_length=1)


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
            "/api/run",
            "/api/run/stream",
            "/api/profile",
            "/api/profile/priority-line/{line_id}",
            "/api/profile/memory-fact/{fact_id}",
            "/api/profile/tier3",
            "/api/clarify",
            "/api/traces",
            "/api/traces/{decision_id}",
            "/api/record-outcome",
            "/api/commit-decision",
            "/api/commits/{decision_id}",
            "/api/outcomes/{decision_id}",
            "/api/shadow/chat",
            "/api/option-chat",
            "/api/transcribe",
            "/api/personalization/ingest",
        ],
    }


@app.get("/health")
def health_alias() -> dict[str, str]:
    return health()


def _client_anchor_iso(client_now_iso: str | None) -> str | None:
    if not client_now_iso or not str(client_now_iso).strip():
        return None
    s = str(client_now_iso).strip()
    return s if len(s) >= 10 else None


@app.post("/api/run", response_model=RunResponse)
def run_decision(body: RunRequest) -> RunResponse:
    settings = load_settings()
    ctx, notes = _build_context(settings)
    trace = run_pipeline(
        ctx,
        body.raw_input.strip(),
        persist_trace=True,
        anchor_now_iso=_client_anchor_iso(body.client_now_iso),
        clarification_answers=body.clarification_answers,
        save_clarification_to_profile=body.save_clarification_to_profile,
        preserve_raw_input=body.preserve_raw_input,
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

    settings = load_settings()
    ctx, notes = _build_context(settings)

    def gen():
        try:
            yield _sse_chunk({"event": "notes", "notes": notes})
            for ev in iter_pipeline_events(
                ctx,
                body.raw_input.strip(),
                persist_trace=True,
                anchor_now_iso=_client_anchor_iso(body.client_now_iso),
                clarification_answers=body.clarification_answers,
                save_clarification_to_profile=body.save_clarification_to_profile,
                preserve_raw_input=body.preserve_raw_input,
            ):
                if ev.get("event") == "complete" and isinstance(ev.get("trace"), dict):
                    tid = ev["trace"].get("decision_id")
                    if isinstance(tid, str) and tid:
                        ev = {**ev, "trace_path": str(settings.traces_dir / f"{tid}.json")}
                yield _sse_chunk(ev)
        except Exception as e:
            # Without this, uvicorn closes the socket mid-chunk → browser ERR_INCOMPLETE_CHUNKED_ENCODING / "network error".
            yield _sse_chunk({"event": "error", "detail": f"{type(e).__name__}: {e!s}"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/run", response_model=RunResponse)
def run_decision_alias(body: RunRequest) -> RunResponse:
    return run_decision(body)


@app.get("/api/profile")
def get_profile() -> dict:
    return load_user_profile().model_dump(mode="json")


@app.put("/api/profile")
def put_profile(body: UserProfile) -> dict:
    """Update user-editable profile fields; keeps system lines + clarification rows; replaces Profile-authored priorities."""
    existing = load_user_profile()
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
    path = save_user_profile(merged)
    return {"ok": True, "path": str(path)}


@app.delete("/api/profile/priority-line/{line_id}")
def delete_priority_line(line_id: str) -> dict:
    existing = load_user_profile()
    updated = delete_priority_line_by_id(existing, line_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="priority_line_not_found")
    path = save_user_profile(updated)
    return {"ok": True, "path": str(path)}


@app.delete("/api/profile/memory-fact/{fact_id}")
def delete_memory_fact(fact_id: str) -> dict:
    existing = load_user_profile()
    updated = delete_memory_fact_by_id(existing, fact_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="memory_fact_not_found")
    path = save_user_profile(updated)
    return {"ok": True, "path": str(path)}


@app.get("/api/profile/tier3")
def get_tier3_profile() -> dict:
    """Tier 3 profile consumed by the recommender prompt."""
    s = load_settings()
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
    settings = load_settings()
    ctx, _notes = _build_context(settings)
    profile = load_user_profile(settings)
    result = run_clarify_gate(body.raw_input.strip(), ctx.llm, profile=profile)
    return result.model_dump(mode="json")


@app.get("/api/traces")
def get_traces() -> list[dict]:
    return [t.model_dump(mode="json") for t in list_traces()]


@app.get("/api/outcomes/{decision_id}")
def get_outcome(decision_id: str) -> dict:
    """Return saved outcome JSON for ``decision_id``, or 404 if none."""
    try:
        o = load_decision_outcome(decision_id)
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


class PersonalizationIngestRequest(BaseModel):
    text: str = Field(min_length=1)


@app.post("/api/personalization/ingest")
def personalization_ingest(body: PersonalizationIngestRequest) -> dict:
    """Analyze pasted/exported chat or email text; merge behavioral insights into UserProfile (+ Tier 3)."""
    settings = load_settings()
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
    settings = load_settings()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Shadow chat requires OPENAI_API_KEY")
    try:
        msgs = [m.model_dump() for m in body.messages]
        reply, flag, state, recorded_facts, used_memory_facts = run_shadow_turn(msgs, settings=settings)
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
    }


@app.post("/api/option-chat")
def option_chat(body: OptionChatRequest) -> dict:
    """Follow-up Q&A for one option card, grounded in the already-generated decision trace."""
    settings = load_settings()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(status_code=503, detail="Option follow-up chat requires OPENAI_API_KEY")
    try:
        trace = load_decision_trace(body.decision_id.strip())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="trace_not_found") from None

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


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)) -> dict:
    """Speech-to-text via OpenAI Whisper (same key as chat)."""
    settings = load_settings()
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


@app.get("/api/traces/{decision_id}")
def get_trace(decision_id: str) -> dict:
    try:
        trace = load_decision_trace(decision_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}") from None
    return trace.model_dump(mode="json")


@app.delete("/api/traces/{decision_id}")
def remove_trace(decision_id: str) -> dict:
    try:
        trace_deleted, outcome_deleted, commit_deleted = delete_trace(decision_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not trace_deleted:
        raise HTTPException(status_code=404, detail=f"Trace not found: {decision_id}")
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
    settings = load_settings()
    try:
        trace = load_decision_trace(body.decision_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trace not found for decision_id={body.decision_id}") from None
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
    c = load_commit(decision_id)
    if c is None:
        raise HTTPException(status_code=404, detail="no_commit")
    return c.model_dump(mode="json")


@app.post("/api/record-outcome", response_model=RecordOutcomeResponse)
def record_outcome(body: RecordOutcomeRequest) -> RecordOutcomeResponse:
    settings = load_settings()
    trace_path = settings.traces_dir / f"{body.decision_id}.json"
    if not trace_path.exists():
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
        trace = load_decision_trace(body.decision_id)
        commit = load_commit(body.decision_id)
        row = build_evaluation_record(trace, outcome, commit=commit)
        append_evaluation_log(row, settings=settings)
        eval_appended = True
    except Exception as exc:
        _log.warning("evaluation_log append failed for %s: %s", body.decision_id, exc)
    return RecordOutcomeResponse(ok=True, outcome_path=str(path), evaluation_log_appended=eval_appended)


@app.post("/record-outcome", response_model=RecordOutcomeResponse)
def record_outcome_alias(body: RecordOutcomeRequest) -> RecordOutcomeResponse:
    return record_outcome(body)
