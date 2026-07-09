"""Paid E2E runner for fictional quality scenarios (manual invoke only)."""

from __future__ import annotations

import json
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

from foresight_x.config import Settings
from foresight_x.profile.store import save_user_profile
from foresight_x.retrieval.memory import UserMemory
from foresight_x.schemas import PastDecision, UserProfile

from tests.eval.runner.llm_counter import count_llm_calls
from tests.eval.runner.run import (
    _capture_env,
    _counter_to_stage_calls,
    _git_sha,
    _llm_preflight,
    _restore_env,
    detect_silent_degradation,
    verify_model_available,
)
from tests.quality.e2e_scoring import aggregate_repeated_scenario_runs, score_scenario
from tests.quality.history import append_dgs_history
from tests.quality.loaders import load_persona
from tests.quality.policy import DEFAULT_POLICY, QualityPolicy, evaluate_run_gate
from tests.quality.quiet import configure_quiet_benchmark
from tests.quality.replay import replay_quality_scenario
from tests.quality.schema import QualityE2EScenario

_EVAL_ENV_KEYS = (
    "FORESIGHT_DATA_DIR",
    "CHROMA_PERSIST_DIR",
    "FORESIGHT_USER_ID",
    "OPENAI_MODEL",
    "GRAPH_ENABLED",
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _seed_quality_persona(*, persona_id: str, model_id: str, runtime_data_root: Path) -> int:
    """Seed profile + Chroma memories. Returns count of seeded past decisions."""
    persona = load_persona(persona_id)
    persona_root = runtime_data_root / f"persona_{persona_id}"
    chroma_dir = persona_root / "chroma"
    settings = Settings(
        foresight_data_dir=persona_root,
        chroma_persist_dir=chroma_dir,
        foresight_user_id=f"quality_{persona_id}",
        openai_model=model_id,
    )
    os.environ["FORESIGHT_DATA_DIR"] = str(persona_root)
    os.environ["CHROMA_PERSIST_DIR"] = str(chroma_dir)
    os.environ["FORESIGHT_USER_ID"] = settings.foresight_user_id
    os.environ["OPENAI_MODEL"] = model_id

    profile_payload = persona.model_dump(mode="json", exclude={"past_decisions"})
    profile = UserProfile.model_validate(profile_payload)
    save_user_profile(profile, settings=settings)

    expected = len(persona.past_decisions)
    if expected == 0:
        return 0
    if not (settings.openai_api_key or "").strip():
        raise RuntimeError(
            f"OPENAI_API_KEY required to seed persona {persona_id} ({expected} past decisions)"
        )
    user_memory = UserMemory(settings.foresight_user_id, settings=settings)
    for row in persona.past_decisions:
        past = PastDecision(
            decision_id=str(row.get("id", "")).strip(),
            situation_summary=str(row.get("situation_summary", "")).strip(),
            chosen_option=str(row.get("chosen_option", "")).strip(),
            outcome=str(row.get("outcome", "")).strip() or None,
            timestamp=str(row.get("timestamp", "")).strip() or _utc_now_iso(),
        )
        user_memory.add_past_decision(
            past,
            packaged_seed=True,
            decision_type=str(row.get("decision_type", "")).strip() or None,
        )
    seeded = len(user_memory.list_all_past_decisions())
    if seeded < expected:
        raise RuntimeError(
            f"persona {persona_id} seed incomplete: expected {expected} past decisions, got {seeded}"
        )

    if settings.graph_enabled:
        _seed_graph_backend_and_drain(persona, settings)

    return seeded


def _seed_graph_backend_and_drain(persona: Any, settings: Settings) -> None:
    """Best-effort: also enqueue past decisions into Graphiti and wait for ingest
    to drain, so scenarios with expect_graph_influence: true get a fair chance at
    a real graph signal instead of racing an async background worker that almost
    always loses within a single quick E2E run. Never raises — a scenario that
    truly cares about graph presence catches the absence via graded scoring, not
    a hard exception here (graph infra flakiness shouldn't crash the whole run).
    """
    try:
        from foresight_x.memory_graph.graphiti_backend import get_graphiti_backend

        backend = get_graphiti_backend(settings.foresight_user_id, settings)
        if backend is None:
            return
        for row in persona.past_decisions:
            text = (
                f"Past decision: {row.get('situation_summary', '')} "
                f"Chose: {row.get('chosen_option', '')} Outcome: {row.get('outcome', '')}"
            ).strip()
            backend.enqueue_external_event(
                text,
                timestamp=str(row.get("timestamp", "")).strip() or None,
                event_type="past_decision",
            )
        backend.wait_for_ingest_drain(timeout=90.0)
    except Exception:
        pass


def _scenarios_need_graph_enabled(scenarios: list[QualityE2EScenario]) -> bool:
    """True when any selected scenario hard-requires graph signal
    (expected.expect_graph_influence) and therefore needs GRAPH_ENABLED=1 for
    the run — otherwise that scenario would always hard-fail regardless of
    whether the Graphiti backend is actually healthy."""
    return any(s.expected.expect_graph_influence for s in scenarios)


def _aggregate(scenario_rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(scenario_rows)
    latencies = sorted(
        int(x.get("metrics", {}).get("infrastructure", {}).get("latency", {}).get("total_ms", 0))
        for x in scenario_rows
    )
    if latencies:
        p50 = int(median(latencies))
        idx95 = max(0, min(len(latencies) - 1, int(round(0.95 * (len(latencies) - 1)))))
        p95 = int(latencies[idx95])
    else:
        p50 = 0
        p95 = 0

    dgs_vals = [float(x.get("metrics", {}).get("dgs", 0.0)) for x in scenario_rows]
    mean_dgs = sum(dgs_vals) / len(dgs_vals) if dgs_vals else 0.0

    # Visible even when not hard-gated (expect_graph_influence defaults False): if
    # this trends toward 0 across a run where graph is enabled, the Graphiti
    # backend is silently degraded and nobody would otherwise notice.
    graph_rows = [x.get("metrics", {}).get("graph", {}) for x in scenario_rows]
    graph_present_count = sum(1 for g in graph_rows if g.get("graph_influence_present"))

    total_actual_calls = sum(int(x.get("metrics", {}).get("llm_calls", {}).get("total", 0)) for x in scenario_rows)
    total_estimated_calls = sum(
        int(x.get("metrics", {}).get("llm_calls", {}).get("estimated", 0)) for x in scenario_rows
    )

    return {
        "mean_dgs": round(mean_dgs, 4),
        "p50_latency_ms": p50,
        "p95_latency_ms": p95,
        "total_llm_calls": total_actual_calls,
        "errors": sum(1 for x in scenario_rows if x.get("status") == "error"),
        "graph_influence_present_count": graph_present_count,
        "graph_influence_coverage": round(graph_present_count / n, 4) if n else 0.0,
        # Feeds back into calibrating _CATEGORY_AVG_CALLS / estimate_cost_usd_weighted
        # over time instead of leaving the pre-run cost estimate unverified forever.
        "total_estimated_llm_calls": total_estimated_calls,
        "estimate_vs_actual_ratio": (
            round(total_actual_calls / total_estimated_calls, 4) if total_estimated_calls else None
        ),
    }


def _run_and_score_once(
    scenario: QualityE2EScenario,
    *,
    model_id: str,
    pol: QualityPolicy,
    traces_dir: Path,
    seeded: int,
    trace_suffix: str = "",
    use_llm_judge: bool = False,
    judge_model_id: str = "gpt-4o-mini",
) -> dict[str, Any]:
    """Run one attempt at a scenario and score it. Pulled out of run_quality_e2e
    so --repeat can call it N times per scenario without duplicating logic."""
    errors: list[str] = []
    try:
        with count_llm_calls() as calls:
            results = replay_quality_scenario(scenario, model_id=model_id)
    except Exception:
        results = []
        errors = [traceback.format_exc()]
        calls = {}

    errors.extend([r.error for r in results if r.error])
    total_calls, first_try_calls, retry_calls, by_stage_calls = _counter_to_stage_calls(dict(calls))

    trace_obj = next((r.decision_trace for r in reversed(results) if r.decision_trace is not None), None)
    degraded_stages = detect_silent_degradation(trace_obj, model_id)
    if degraded_stages:
        errors.append(f"silent_degradation: stages={degraded_stages}")

    scored = score_scenario(
        scenario,
        results,
        llm_total=total_calls,
        errors=[e for e in errors if e],
        degraded_stages=degraded_stages,
        policy_require_safety=pol.require_safety_pass,
        policy_require_no_degradation=pol.require_no_silent_degradation,
        use_llm_judge=use_llm_judge,
        judge_model_id=judge_model_id,
    )
    estimated_calls = int(scenario.metadata.estimated_llm_calls or 0)
    scored["metrics"]["llm_calls"] = {
        "total": total_calls,
        "first_try": first_try_calls,
        "retries": retry_calls,
        "by_stage": by_stage_calls,
        "budget": int(scenario.metadata.llm_call_count_budget),
        "within_budget": total_calls <= int(scenario.metadata.llm_call_count_budget),
        # Pre-run estimate carried through to the report so estimate-vs-actual
        # drift is visible per scenario, not just as an isolated pre-run guess
        # that's forgotten the moment the run starts.
        "estimated": estimated_calls,
    }
    scored["category"] = scenario.category
    scored["persona_id"] = scenario.persona_id
    scored["seeded_memories"] = seeded

    trace_path: str | None = None
    trace_id: str | None = None
    if trace_obj is not None:
        trace_id = trace_obj.decision_id
        trace_file = traces_dir / f"{scenario.id}{trace_suffix}.json"
        trace_file.write_text(trace_obj.model_dump_json(indent=2), encoding="utf-8")
        trace_path = str(trace_file)

    scored["raw"] = {
        "decision_trace_id": trace_id,
        "decision_trace_path": trace_path,
        "system_outputs_per_turn": [r.system_output for r in results],
    }
    return scored


def run_quality_e2e(
    *,
    selected_scenarios: list[QualityE2EScenario],
    out_dir: Path,
    model_id: str,
    policy: QualityPolicy | None = None,
    repeat: int = 1,
    use_llm_judge: bool = False,
    judge_model_id: str = "gpt-4o-mini",
) -> tuple[Path, dict[str, Any]]:
    configure_quiet_benchmark()
    pol = policy or DEFAULT_POLICY
    started = datetime.now(timezone.utc)
    run_id = str(uuid.uuid4())
    timestamp = started.strftime("%Y%m%dT%H%M%SZ")
    commit_sha = _git_sha()
    out_dir.mkdir(parents=True, exist_ok=True)
    traces_dir = out_dir / "traces" / run_id
    traces_dir.mkdir(parents=True, exist_ok=True)
    runtime_data_root = out_dir / "_runtime_data" / run_id
    runtime_data_root.mkdir(parents=True, exist_ok=True)

    grouped: dict[str, list[QualityE2EScenario]] = {}
    for s in selected_scenarios:
        grouped.setdefault(s.persona_id, []).append(s)

    preflight_ok, preflight_error = _llm_preflight(model_id)
    if not preflight_ok:
        raise RuntimeError(preflight_error or "llm_preflight_failed")
    verify_model_available(model_id, Settings(openai_model=model_id))

    scenario_rows: list[dict[str, Any]] = []
    # Snapshot BEFORE any mutation below, so _restore_env puts GRAPH_ENABLED back
    # to its true prior state (often unset) rather than leaking "1" past this run.
    env_snapshot = _capture_env(_EVAL_ENV_KEYS)
    try:
        # A scenario that declares expect_graph_influence: true but runs with the
        # default GRAPH_ENABLED=0 would ALWAYS hard-fail with graph_influence_absent
        # — indistinguishable from a real backend degradation, since the graph path
        # is unconditionally off. Auto-enable it for this run so the flag tests what
        # it says it tests, instead of silently requiring an easy-to-forget env var.
        if _scenarios_need_graph_enabled(selected_scenarios):
            os.environ["GRAPH_ENABLED"] = "1"
        n_repeat = max(1, int(repeat))
        for persona_id, scenarios in grouped.items():
            seeded = _seed_quality_persona(
                persona_id=persona_id, model_id=model_id, runtime_data_root=runtime_data_root
            )
            for scenario in scenarios:
                attempts = [
                    _run_and_score_once(
                        scenario,
                        model_id=model_id,
                        pol=pol,
                        traces_dir=traces_dir,
                        seeded=seeded,
                        trace_suffix=(f"_r{i}" if n_repeat > 1 else ""),
                        use_llm_judge=use_llm_judge,
                        judge_model_id=judge_model_id,
                    )
                    for i in range(n_repeat)
                ]
                scenario_rows.append(aggregate_repeated_scenario_runs(attempts))
    finally:
        _restore_env(env_snapshot)

    gate = evaluate_run_gate(scenario_rows, policy=pol)
    duration_s = round((datetime.now(timezone.utc) - started).total_seconds(), 3)
    report = {
        "run_id": run_id,
        "commit_sha": commit_sha,
        "timestamp": _utc_now_iso(),
        "model_id": model_id,
        "suite": "quality-e2e",
        "repeat": max(1, int(repeat)),
        "llm_judge_enabled": bool(use_llm_judge),
        "duration_seconds": duration_s,
        "policy": {
            "min_mean_dgs": pol.min_mean_dgs,
            "min_scenario_dgs": pol.min_scenario_dgs,
            "require_safety_pass": pol.require_safety_pass,
            "require_no_silent_degradation": pol.require_no_silent_degradation,
        },
        "gate": {
            "pass": gate.gate_pass,
            "mean_dgs": gate.mean_dgs,
            "scenario_pass_count": gate.scenario_pass_count,
            "scenario_total": gate.scenario_total,
            "errors": gate.errors,
            "failures": gate.failures,
            "quarantined": gate.quarantined,
            "high_variance": gate.high_variance,
        },
        "scenarios": scenario_rows,
        "aggregate": _aggregate(scenario_rows),
    }
    out_path = out_dir / f"quality-{commit_sha}-{timestamp}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    append_dgs_history(report)
    return out_path, report
