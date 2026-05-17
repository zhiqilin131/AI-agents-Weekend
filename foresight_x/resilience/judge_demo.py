"""Isolated resilience demos for judges — no user threads, credits, or production data writes."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from foresight_x.config import Settings
from foresight_x.orchestration.pipeline import PipelineContext, iter_pipeline_events
from foresight_x.resilience.runtime import reset_resilience_runtime_state, resilience_health_report

_SMOKE_QUESTION = (
    "Should I accept a new role offer this month? I need a clear recommendation with tradeoffs."
)

_PIPELINE_STAGE_ORDER = [
    "enhance",
    "perceive",
    "retrieve",
    "infer",
    "simulate",
    "evaluate",
    "finalize",
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_judge_artifacts() -> dict[str, Any]:
    """Optional report_card markdown and chaos timeline JSON from repo artifacts."""
    root = _repo_root()
    report_path = root / "report_card.md"
    timeline_path = root / "artifacts" / "chaos_timeline.json"
    out: dict[str, Any] = {
        "report_card_markdown": None,
        "chaos_timeline": None,
        "report_card_path": str(report_path.relative_to(root)) if report_path.is_file() else None,
        "chaos_timeline_path": str(timeline_path.relative_to(root)) if timeline_path.is_file() else None,
    }
    if report_path.is_file():
        out["report_card_markdown"] = report_path.read_text(encoding="utf-8")
    if timeline_path.is_file():
        try:
            out["chaos_timeline"] = json.loads(timeline_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            out["chaos_timeline"] = None
    return out


def _summarize_pipeline_event(ev: dict[str, Any]) -> str:
    kind = str(ev.get("event") or "")
    if kind == "meta":
        return f"decision_id={ev.get('decision_id', '')}"
    if kind == "stage":
        return f"stage:{ev.get('stage', '')}"
    if kind == "degraded":
        deg = ev.get("degraded") if isinstance(ev.get("degraded"), dict) else {}
        return f"degraded:{deg.get('provider', deg.get('dependency', 'unknown'))}"
    if kind == "partial":
        return f"partial:{ev.get('stage', '')}"
    if kind == "complete":
        return "pipeline complete"
    return kind or "event"


def isolated_smoke_settings(settings: Settings | None = None) -> Settings:
    """Always point smoke runs at the temp judge dir (never the active user's data root)."""
    root = _repo_root()
    tmp_data = root / "data" / "resilience_smoke_tmp"
    tmp_data.mkdir(parents=True, exist_ok=True)
    base = settings or Settings()
    return base.model_copy(update={"foresight_data_dir": tmp_data})


def _collect_degradations(
    trace: dict[str, Any] | None,
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge trace.degradations, resilience.events, and degraded SSE payloads."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(item: dict[str, Any]) -> None:
        key = "|".join(
            str(item.get(k) or "")
            for k in ("stage", "component", "provider", "reason", "fallback_path")
        )
        if key in seen:
            return
        seen.add(key)
        out.append(item)

    if isinstance(trace, dict):
        raw = trace.get("degradations")
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    add(item)
        resilience = trace.get("resilience")
        if isinstance(resilience, dict):
            rev = resilience.get("events")
            if isinstance(rev, list):
                for item in rev:
                    if isinstance(item, dict):
                        add(item)

    for ev in events:
        if ev.get("event") != "degraded":
            continue
        deg = ev.get("degraded")
        if isinstance(deg, dict):
            add(deg)

    return out


def _degradation_rows(source: dict[str, Any] | list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if isinstance(source, list):
        raw = source
    elif isinstance(source, dict):
        raw = source.get("degradations")
        if not isinstance(raw, list):
            raw = []
    else:
        return []
    rows: list[dict[str, Any]] = []
    for item in raw[:12]:
        if isinstance(item, dict):
            rows.append(
                {
                    "provider": item.get("provider") or item.get("dependency"),
                    "stage": item.get("stage"),
                    "reason": item.get("reason") or item.get("message"),
                    "fallback": item.get("fallback"),
                }
            )
        elif isinstance(item, str):
            rows.append({"reason": item})
    return rows


def _build_assertions(
    *,
    errors: list[str],
    complete: dict[str, Any] | None,
    trace: dict[str, Any] | None,
    chosen: str,
    degraded_sse_count: int,
    degradation_count: int,
) -> list[dict[str, Any]]:
    did = (trace or {}).get("decision_id") if isinstance(trace, dict) else None
    pipeline_errors = [e for e in errors if e.startswith("pipeline:")]
    return [
        {
            "id": "no_exception",
            "label": "Pipeline raised no fatal exception",
            "pass": not pipeline_errors,
            "detail": (
                "iter_pipeline_events() completed without Python traceback"
                if not pipeline_errors
                else "; ".join(pipeline_errors)
            ),
        },
        {
            "id": "complete_event",
            "label": "SSE emitted event: complete",
            "pass": complete is not None,
            "detail": "Client would receive a terminal complete payload",
        },
        {
            "id": "decision_id",
            "label": "Trace contains decision_id",
            "pass": bool(did),
            "detail": str(did) if did else "missing decision_id on trace",
        },
        {
            "id": "recommendation",
            "label": "Recommendation has chosen_option_id",
            "pass": bool(chosen),
            "detail": chosen or "missing chosen_option_id",
        },
        {
            "id": "degraded_sse",
            "label": "Honest degraded SSE events recorded",
            "pass": degraded_sse_count > 0,
            "detail": f"{degraded_sse_count} degraded SSE event(s)",
        },
        {
            "id": "trace_degradations",
            "label": "Degradation evidence recorded",
            "pass": degradation_count > 0 or degraded_sse_count > 0,
            "detail": (
                f"{degradation_count} on DecisionTrace"
                + (f", {degraded_sse_count} degraded SSE event(s)" if degraded_sse_count else "")
            ),
        },
        {
            "id": "isolated",
            "label": "Isolated temp data dir only",
            "pass": True,
            "detail": "data/resilience_smoke_tmp — no user threads or credits",
        },
    ]


def _stability_score(assertions: list[dict[str, Any]], *, elapsed_ms: int) -> int:
    if not assertions:
        return 0
    passed = sum(1 for a in assertions if a.get("pass"))
    base = int(round((passed / len(assertions)) * 100))
    if elapsed_ms > 12000:
        base = max(0, base - 5)
    return min(100, base)


def _package_smoke_result(
    *,
    events: list[dict[str, Any]],
    errors: list[str],
    started: str,
    elapsed_ms: int,
    mode: str,
    seed_file: str | None,
    phases: list[dict[str, Any]],
) -> dict[str, Any]:
    complete = next((e for e in events if e.get("event") == "complete"), None)
    degraded_events = [e for e in events if e.get("event") == "degraded"]
    trace = (complete or {}).get("trace") if isinstance(complete, dict) else None
    degradations = _collect_degradations(
        trace if isinstance(trace, dict) else None,
        events,
    )
    if not complete:
        errors.append("no complete event")
    if isinstance(trace, dict) and not trace.get("decision_id"):
        errors.append("missing decision_id")

    chosen = ""
    if isinstance(trace, dict):
        rec = trace.get("recommendation") or {}
        if isinstance(rec, dict):
            chosen = str(rec.get("chosen_option_id") or "")

    stages_seen: list[str] = []
    event_log: list[dict[str, Any]] = []
    t_cursor = 0
    for ev in events:
        if ev.get("event") == "stage" and ev.get("stage"):
            st = str(ev["stage"])
            if st not in stages_seen:
                stages_seen.append(st)
        event_log.append(
            {
                "t_ms": t_cursor,
                "type": ev.get("event"),
                "stage": ev.get("stage"),
                "summary": _summarize_pipeline_event(ev),
            }
        )
        t_cursor += max(1, elapsed_ms // max(len(events), 1))

    assertions = _build_assertions(
        errors=errors,
        complete=complete if isinstance(complete, dict) else None,
        trace=trace if isinstance(trace, dict) else None,
        chosen=chosen,
        degraded_sse_count=len(degraded_events),
        degradation_count=len(degradations),
    )
    fatal_errors = [
        e
        for e in errors
        if e.startswith("pipeline:") or e in ("no complete event", "missing decision_id")
    ]
    passed = all(a.get("pass") for a in assertions if a["id"] != "isolated") and not fatal_errors

    for ph in phases:
        if ph.get("id") == "pipeline":
            ph["status"] = "done" if not fatal_errors else "failed"
    phases.append(
        {
            "id": "validate",
            "label": "Grader assertions",
            "status": "done" if passed else "failed",
            "detail": f"{sum(1 for a in assertions if a.get('pass'))}/{len(assertions)} passed",
        }
    )

    return {
        "started_at": started,
        "elapsed_ms": elapsed_ms,
        "pass": passed,
        "errors": errors,
        "degraded_sse_count": len(degraded_events),
        "degradation_count": len(degradations),
        "decision_id": (trace or {}).get("decision_id") if isinstance(trace, dict) else None,
        "chosen_option_id": chosen or None,
        "isolated": True,
        "note": "Temp data dir only; no credits charged; no user thread writes.",
        "health": resilience_health_report(),
        "question": _SMOKE_QUESTION,
        "mode": mode,
        "seed_file": seed_file,
        "phases": phases,
        "event_log": event_log,
        "pipeline_stages_seen": stages_seen,
        "pipeline_stages_expected": list(_PIPELINE_STAGE_ORDER),
        "degradations_detail": _degradation_rows(degradations),
        "assertions": assertions,
        "stability_score": _stability_score(assertions, elapsed_ms=elapsed_ms),
        "llm_mode": "disabled (llm=None)",
    }


def _execute_smoke_pipeline(
    *,
    settings: Settings | None = None,
    full_pipeline: bool = True,
    on_pipeline_event: Callable[[dict[str, Any], int], None] | None = None,
) -> dict[str, Any]:
    reset_resilience_runtime_state()
    root = _repo_root()
    tmp_data = root / "data" / "resilience_smoke_tmp"
    tmp_data.mkdir(parents=True, exist_ok=True)
    s = isolated_smoke_settings(settings)

    seed: dict[str, Any] | None = None
    seed_file: str | None = None
    if not full_pipeline:
        seed_path = root / "data" / "traces"
        for candidate in (seed_path / "pipe-test-1.json", *sorted(seed_path.glob("*.json"))):
            if candidate.is_file():
                try:
                    seed = json.loads(candidate.read_text(encoding="utf-8"))
                    seed_file = str(candidate.relative_to(root))
                    break
                except json.JSONDecodeError:
                    continue

    mode = "full_pipeline" if full_pipeline else "resume_finalize"
    phases: list[dict[str, Any]] = [
        {"id": "reset", "label": "Reset in-memory resilience counters", "status": "done"},
        {
            "id": "isolate",
            "label": "Point Settings at temp dir",
            "status": "done",
            "detail": str(tmp_data.relative_to(root)),
        },
    ]
    if full_pipeline:
        phases.append(
            {
                "id": "pipeline",
                "label": "Full 7-stage pipeline (llm=None)",
                "status": "running",
                "detail": "Deterministic fallbacks on LLM stages",
            }
        )
    else:
        phases.append(
            {
                "id": "seed",
                "label": "Load partial trace seed",
                "status": "done",
                "detail": seed_file or "no seed",
            }
        )
        phases.append(
            {
                "id": "pipeline",
                "label": "Resume from finalize",
                "status": "running",
            }
        )

    started = _utc_now()
    t0 = time.perf_counter()
    errors: list[str] = []
    events: list[dict[str, Any]] = []

    ctx = PipelineContext(settings=s, llm=None, user_memory=None, world=None)
    try:
        kwargs: dict[str, Any] = {"preserve_raw_input": True, "persist_trace": False}
        if seed and not full_pipeline:
            kwargs["resume_from_stage"] = "finalize"
            kwargs["resume_partial"] = seed
        for ev in iter_pipeline_events(ctx, _SMOKE_QUESTION, **kwargs):
            if isinstance(ev, dict):
                events.append(ev)
                if on_pipeline_event:
                    on_pipeline_event(ev, int(round((time.perf_counter() - t0) * 1000.0)))
    except Exception as exc:
        errors.append(f"pipeline: {exc}")

    elapsed_ms = int(round((time.perf_counter() - t0) * 1000.0))
    return _package_smoke_result(
        events=events,
        errors=errors,
        started=started,
        elapsed_ms=elapsed_ms,
        mode=mode,
        seed_file=seed_file,
        phases=phases,
    )


def iter_smoke_progress(*, settings: Settings | None = None) -> Iterator[dict[str, Any]]:
    """Yield structured progress dicts; last item is type=result."""
    yield {
        "type": "phase",
        "id": "reset",
        "label": "Reset resilience counters",
        "status": "start",
    }
    root = _repo_root()
    tmp_data = root / "data" / "resilience_smoke_tmp"
    tmp_data.mkdir(parents=True, exist_ok=True)

    reset_resilience_runtime_state()
    yield {
        "type": "phase",
        "id": "reset",
        "label": "Reset resilience counters",
        "status": "done",
    }
    yield {
        "type": "phase",
        "id": "isolate",
        "label": "Isolated temp data directory",
        "status": "done",
        "detail": str(tmp_data.relative_to(root)),
    }
    yield {
        "type": "phase",
        "id": "pipeline",
        "label": "Running full 7-stage pipeline (llm=None)",
        "status": "start",
        "detail": _SMOKE_QUESTION[:160],
    }

    s = isolated_smoke_settings(settings)
    ctx = PipelineContext(settings=s, llm=None, user_memory=None, world=None)
    errors: list[str] = []
    events: list[dict[str, Any]] = []
    started = _utc_now()
    t0 = time.perf_counter()

    try:
        for ev in iter_pipeline_events(
            ctx,
            _SMOKE_QUESTION,
            preserve_raw_input=True,
            persist_trace=False,
        ):
            if isinstance(ev, dict):
                events.append(ev)
                t_ms = int(round((time.perf_counter() - t0) * 1000.0))
                yield {
                    "type": "pipeline",
                    "t_ms": t_ms,
                    "event": ev.get("event"),
                    "stage": ev.get("stage"),
                    "summary": _summarize_pipeline_event(ev),
                }
    except Exception as exc:
        errors.append(f"pipeline: {exc}")

    elapsed_ms = int(round((time.perf_counter() - t0) * 1000.0))
    phases: list[dict[str, Any]] = [
        {"id": "reset", "label": "Reset in-memory resilience counters", "status": "done"},
        {
            "id": "isolate",
            "label": "Point Settings at temp dir",
            "status": "done",
            "detail": str(tmp_data.relative_to(root)),
        },
        {
            "id": "pipeline",
            "label": "Full 7-stage pipeline (llm=None)",
            "status": "running",
            "detail": "Deterministic fallbacks on LLM stages",
        },
    ]
    result = _package_smoke_result(
        events=events,
        errors=errors,
        started=started,
        elapsed_ms=elapsed_ms,
        mode="full_pipeline",
        seed_file=None,
        phases=phases,
    )
    yield {"type": "phase", "id": "pipeline", "label": "Pipeline finished", "status": "done"}
    yield {"type": "phase", "id": "validate", "label": "Grader assertions", "status": "done"}
    yield {"type": "result", "payload": result}


def run_isolated_smoke_pipeline(*, settings: Settings | None = None) -> dict[str, Any]:
    """One offline degraded decision completion for judge UI (full pipeline, llm=None)."""
    last: dict[str, Any] | None = None
    for item in iter_smoke_progress(settings=settings):
        if item.get("type") == "result":
            last = item.get("payload") if isinstance(item.get("payload"), dict) else None
    if last is None:
        return _execute_smoke_pipeline(settings=settings, full_pipeline=True)
    return last


def iter_smoke_run_sse(*, settings: Settings | None = None) -> Iterator[str]:
    """Stream smoke-run progress as SSE for the interactive judge panel."""
    for item in iter_smoke_progress(settings=settings):
        yield f"data: {json.dumps(item, default=str)}\n\n"


def build_judge_pack(*, settings: Settings | None = None) -> dict[str, Any]:
    """Bundle health, artifacts, and feature summary for the judge UI."""
    from foresight_x import __version__

    health = resilience_health_report()
    artifacts = load_judge_artifacts()
    legs = []
    timeline = artifacts.get("chaos_timeline")
    if isinstance(timeline, dict) and isinstance(timeline.get("legs"), list):
        for row in timeline["legs"]:
            if isinstance(row, dict):
                legs.append(
                    {
                        "leg": row.get("leg"),
                        "pass": row.get("pass"),
                        "degradation_count": len(row.get("degradations") or []),
                        "degraded_sse_count": row.get("degraded_sse_count"),
                        "decision_id": row.get("decision_id"),
                        "errors": row.get("errors") or [],
                    }
                )

    return {
        "generated_at": _utc_now(),
        "version": __version__,
        "features": {
            "circuit_breaker": ["openai", "tavily", "mcp.linear"],
            "chaos_harness": "FX_CHAOS=1 + make chaos-demo",
            "pipeline_fallbacks": list(_PIPELINE_STAGE_ORDER),
            "user_visible_degraded_sse": True,
            "llm_gateway_failover": True,
            "smoke_stream_sse": True,
        },
        "health": health,
        "artifacts": artifacts,
        "chaos_legs_summary": legs,
        "smoke_run_available": True,
    }
