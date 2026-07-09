"""Score existing quality E2E reports or trace files without re-running LLM calls."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from foresight_x.schemas import DecisionTrace

from tests.quality.e2e_scoring import score_scenario
from tests.quality.loaders import load_e2e_scenarios, quality_root, resolve_e2e
from tests.quality.policy import DEFAULT_POLICY, QualityPolicy, evaluate_run_gate
from tests.quality.replay import TurnResult
from tests.quality.schema import QualityE2EScenario


def _trace_to_turn_results(trace: DecisionTrace, scenario: QualityE2EScenario) -> list[TurnResult]:
    output = trace.recommendation.reasoning or ""
    return [
        TurnResult(
            turn_index=0,
            user_input=trace.original_user_input or trace.user_state.raw_input,
            system_output=output,
            decision_trace=trace,
            stage_latency_ms=dict(trace.runtime.per_stage_latency_ms) if trace.runtime else {},
            total_latency_ms=int(trace.runtime.total_latency_ms) if trace.runtime else 0,
            llm_calls={},
            error=None,
        )
    ]


def score_trace_file(
    scenario: QualityE2EScenario,
    trace_path: Path,
    *,
    llm_total: int = 0,
    policy: QualityPolicy | None = None,
) -> dict[str, Any]:
    pol = policy or DEFAULT_POLICY
    trace = DecisionTrace.model_validate_json(trace_path.read_text(encoding="utf-8"))
    results = _trace_to_turn_results(trace, scenario)
    return score_scenario(
        scenario,
        results,
        llm_total=llm_total,
        errors=[],
        degraded_stages=None,
        policy_require_safety=pol.require_safety_pass,
        policy_require_no_degradation=False,
    )


def score_report_file(report_path: Path, *, policy: QualityPolicy | None = None) -> dict[str, Any]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    pol = policy or DEFAULT_POLICY
    gate = evaluate_run_gate(report.get("scenarios") or [], policy=pol)
    report["gate"] = {
        "pass": gate.gate_pass,
        "mean_dgs": gate.mean_dgs,
        "scenario_pass_count": gate.scenario_pass_count,
        "scenario_total": gate.scenario_total,
        "errors": gate.errors,
        "failures": gate.failures,
        "quarantined": gate.quarantined,
        "high_variance": gate.high_variance,
    }
    return report


def rescore_traces_dir(
    traces_dir: Path,
    suite: str,
    *,
    policy: QualityPolicy | None = None,
) -> dict[str, Any]:
    scenarios = resolve_e2e(suite, load_e2e_scenarios())
    by_id = {s.id: s for s in scenarios}
    rows: list[dict[str, Any]] = []
    for path in sorted(traces_dir.glob("*.json")):
        sid = path.stem
        if sid not in by_id:
            continue
        rows.append(score_trace_file(by_id[sid], path, policy=policy))
    gate = evaluate_run_gate(rows, policy=policy or DEFAULT_POLICY)
    return {
        "scenarios": rows,
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
    }


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Score quality E2E reports/traces (no LLM).")
    p.add_argument("--report", type=Path, help="Existing quality-*.json report to re-evaluate gate")
    p.add_argument("--traces-dir", type=Path, help="Directory of scenario trace JSON files")
    p.add_argument("--suite", default="e2e-core", help="Suite selector when using --traces-dir")
    p.add_argument("--min-mean-dgs", type=float, default=None)
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    pol = QualityPolicy.from_env()
    if args.min_mean_dgs is not None:
        pol = QualityPolicy(
            min_mean_dgs=args.min_mean_dgs,
            min_scenario_dgs=pol.min_scenario_dgs,
            max_errors=pol.max_errors,
            require_safety_pass=pol.require_safety_pass,
            require_no_silent_degradation=pol.require_no_silent_degradation,
        )

    if args.report:
        out = score_report_file(args.report, policy=pol)
        gate = out["gate"]
        for line in evaluate_run_gate(out.get("scenarios") or [], policy=pol).summary_lines():
            print(line)
        return 0 if gate.get("pass") else 1

    if args.traces_dir:
        out = rescore_traces_dir(args.traces_dir, args.suite, policy=pol)
        gate_obj = out["gate"]
        result = evaluate_run_gate(out["scenarios"], policy=pol)
        for line in result.summary_lines():
            print(line)
        for row in out["scenarios"]:
            dgs = row.get("metrics", {}).get("dgs", 0)
            print(f"  {row.get('scenario_id')}: dgs={dgs:.3f} status={row.get('status')}")
        return 0 if gate_obj.get("pass") else 1

    print("Provide --report or --traces-dir", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
