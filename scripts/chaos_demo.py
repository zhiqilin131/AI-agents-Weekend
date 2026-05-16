"""Chaos demo: scripted fault injection timeline with PASS/FAIL per leg (requires ``FX_CHAOS=1``)."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from foresight_x.config import Settings
from foresight_x.orchestration.chaos import (
    TARGET_LLM_PRIMARY,
    TARGET_MCP_LINEAR,
    TARGET_TAVILY,
    ChaosProfile,
    apply_env_leg,
    chaos_armed,
    clear_runtime_profiles,
    reset_partial_json_slots,
)
from foresight_x.orchestration.pipeline import PipelineContext, iter_pipeline_events, run_pipeline
from foresight_x.resilience.runtime import reset_resilience_runtime_state, resilience_health_report

ARTIFACTS_DIR = REPO_ROOT / "artifacts"
TIMELINE_PATH = ARTIFACTS_DIR / "chaos_timeline.json"
REPORT_PATH = REPO_ROOT / "report_card.md"

# Accelerated timings for CI; set CHAOS_DEMO_REALTIME=1 for full 10s/30s pacing.
FAST = os.getenv("CHAOS_DEMO_REALTIME", "").strip().lower() not in ("1", "true", "yes")
LEG_DWELL_SEC = 0.15 if FAST else 10.0
CHAOS_DWELL_SEC = 0.35 if FAST else 30.0

LEGS: list[tuple[str, dict[str, ChaosProfile | str], float, set[str]]] = [
    ("healthy", {}, LEG_DWELL_SEC, set()),
    (
        "primary_5xx",
        {TARGET_LLM_PRIMARY: ChaosProfile(status=500, outage=True)},
        CHAOS_DWELL_SEC,
        {"openai", "llm", "llm.primary"},
    ),
    (
        "primary_429",
        {TARGET_LLM_PRIMARY: ChaosProfile(status=429)},
        CHAOS_DWELL_SEC,
        {"openai", "llm", "llm.primary"},
    ),
    (
        "tavily_outage",
        {TARGET_TAVILY: ChaosProfile(outage=True)},
        CHAOS_DWELL_SEC,
        {"tavily"},
    ),
    (
        "linear_mcp_outage",
        {TARGET_MCP_LINEAR: ChaosProfile(outage=True)},
        CHAOS_DWELL_SEC,
        {"linear_mcp", "mcp.linear"},
    ),
    ("recovery", {}, LEG_DWELL_SEC, set()),
]

_SEED_TRACE: dict | None = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_seed_trace() -> dict:
    global _SEED_TRACE
    if _SEED_TRACE is not None:
        return _SEED_TRACE
    traces_dir = REPO_ROOT / "data" / "traces"
    for candidate in (traces_dir / "pipe-test-1.json", *sorted(traces_dir.glob("*.json"))):
        if candidate.is_file():
            _SEED_TRACE = json.loads(candidate.read_text(encoding="utf-8"))
            return _SEED_TRACE
    tmp_data = REPO_ROOT / "data" / "chaos_demo_tmp"
    tmp_data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FORESIGHT_DATA_DIR", str(tmp_data))
    os.environ.setdefault("TAVILY_API_KEY", "")
    settings = Settings(foresight_data_dir=tmp_data)
    ctx = PipelineContext(settings=settings, llm=None, user_memory=None, world=None)
    trace = run_pipeline(
        ctx,
        "I need to decide whether to accept a new role this month.",
        decision_id="chaos-seed",
        persist_trace=False,
    )
    _SEED_TRACE = trace.model_dump(mode="json")
    seed_path = traces_dir / "chaos-seed.json"
    traces_dir.mkdir(parents=True, exist_ok=True)
    seed_path.write_text(json.dumps(_SEED_TRACE, ensure_ascii=False, indent=2), encoding="utf-8")
    return _SEED_TRACE


def _degradation_components(degradations: list) -> set[str]:
    comps: set[str] = set()
    for d in degradations:
        if not isinstance(d, dict):
            continue
        c = str(d.get("component") or "").strip().lower()
        if c:
            comps.add(c)
    return comps


def _run_leg(
    leg_name: str,
    profiles: dict[str, ChaosProfile | str],
    expect_components: set[str],
) -> dict:
    reset_resilience_runtime_state()
    clear_runtime_profiles()
    reset_partial_json_slots()
    apply_env_leg(profiles)

    started = _utc_now()
    t0 = time.perf_counter()
    errors: list[str] = []

    seed = _ensure_seed_trace()
    tmp_data = REPO_ROOT / "data" / "chaos_demo_tmp"
    tmp_data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FORESIGHT_DATA_DIR", str(tmp_data))
    os.environ.setdefault("TAVILY_API_KEY", "")
    settings = Settings(foresight_data_dir=tmp_data)
    ctx = PipelineContext(settings=settings, llm=None, user_memory=None, world=None)
    try:
        events = list(
            iter_pipeline_events(
                ctx,
                "I need to decide whether to accept a new role this month.",
                preserve_raw_input=True,
                resume_from_stage="finalize",
                resume_partial=seed,
                persist_trace=False,
            )
        )
    except Exception as exc:
        errors.append(f"pipeline error: {exc}")
        events = []

    complete = next((e for e in events if e.get("event") == "complete"), None)
    degraded_events = [e for e in events if e.get("event") == "degraded"]

    trace = (complete or {}).get("trace") if isinstance(complete, dict) else None
    degradations = trace.get("degradations") if isinstance(trace, dict) else None
    if not isinstance(degradations, list):
        errors.append("missing trace.degradations")
        degradations = []

    if not complete:
        errors.append("no complete event")

    if isinstance(trace, dict) and not trace.get("decision_id"):
        errors.append("complete missing decision_id")

    comps = _degradation_components(degradations)
    if expect_components and not (comps & expect_components):
        errors.append(f"expected degradation component in {sorted(expect_components)}, got {sorted(comps)}")

    if expect_components and not degraded_events:
        errors.append("no degraded SSE events")

    health_body = resilience_health_report()

    elapsed_ms = int(round((time.perf_counter() - t0) * 1000.0))
    passed = not errors

    return {
        "leg": leg_name,
        "started_at": started,
        "elapsed_ms": elapsed_ms,
        "pass": passed,
        "errors": errors,
        "profiles": {k: (v.legacy_mode() if isinstance(v, ChaosProfile) else str(v)) for k, v in profiles.items()},
        "degradations": degradations,
        "degraded_sse_count": len(degraded_events),
        "decision_id": (trace or {}).get("decision_id") if isinstance(trace, dict) else None,
        "health": health_body,
    }


def main() -> int:
    os.environ.setdefault("FX_CHAOS", "1")
    if not chaos_armed():
        print("FAIL: FX_CHAOS must be set (e.g. FX_CHAOS=1 make chaos-demo)", file=sys.stderr)
        return 1

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    timeline: dict = {
        "generated_at": _utc_now(),
        "fast_mode": FAST,
        "fx_chaos": True,
        "legs": [],
    }

    all_pass = True
    for leg_name, profiles, dwell, expect in LEGS:
        if dwell > 0:
            time.sleep(dwell)
        row = _run_leg(leg_name, profiles, expect)
        timeline["legs"].append(row)
        status = "PASS" if row["pass"] else "FAIL"
        print(f"LEG {leg_name}: {status}" + (f" — {', '.join(row['errors'])}" if row["errors"] else ""))
        if not row["pass"]:
            all_pass = False

    TIMELINE_PATH.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {TIMELINE_PATH}")

    lines = [
        "# Resilience Report Card",
        "",
        f"Generated: {timeline['generated_at']}",
        f"Fast mode: {FAST}",
        "",
        "## Chaos timeline",
        "",
    ]
    for row in timeline["legs"]:
        lines.append(
            f"- **{row['leg']}**: {'PASS' if row['pass'] else 'FAIL'}"
            f" — degradations={len(row.get('degradations') or [])},"
            f" degraded_sse={row.get('degraded_sse_count', 0)},"
            f" decision_id={row.get('decision_id')}"
        )
        if row.get("errors"):
            lines.append(f"  - errors: {', '.join(row['errors'])}")
    lines.extend(["", f"Full timeline: `{TIMELINE_PATH.relative_to(REPO_ROOT)}`", ""])
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {REPORT_PATH}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
