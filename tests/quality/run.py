"""Unified entry point for the cost-friendly quality benchmark."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from tests.quality.quiet import benchmark_env, configure_quiet_benchmark

configure_quiet_benchmark()

from tests.quality.e2e_runner import run_quality_e2e
from tests.quality.loaders import load_e2e_scenarios, quality_root, resolve_e2e
from tests.quality.metrics import estimate_cost_usd, estimate_llm_calls
from tests.quality.policy import QualityPolicy, evaluate_run_gate

_ROOT = quality_root()


def _parse_model_ids(raw: str | None) -> list[str]:
    """Comma-separated --model support for multi-model comparison runs, e.g.
    --model gpt-4o-mini,gpt-4o. Pulled out as a pure function so the parsing
    itself (whitespace/empty-segment handling) is unit-testable without
    spinning up a real E2E run."""
    source = raw or os.getenv("EVAL_MODEL_ID") or "gpt-4o-mini"
    return [m.strip() for m in source.split(",") if m.strip()]


def _run_pytest(target: str) -> int:
    env = os.environ.copy()
    env.update(benchmark_env())
    cmd = [sys.executable, "-m", "pytest", target, "-q", "--tb=short", "--disable-warnings"]
    return subprocess.call(cmd, cwd=str(_ROOT.parents[1]), env=env)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Cost-friendly quality benchmark (manual invoke).")
    p.add_argument(
        "--suite",
        default="free",
        choices=["free", "graph", "mcda", "report", "memory", "e2e-smoke", "e2e-core", "e2e-all"],
    )
    p.add_argument("--confirm", action="store_true", help="Required for paid E2E suites")
    p.add_argument(
        "--model",
        default=None,
        help="Model id override (default: gpt-4o-mini). Comma-separated for multi-model comparison, e.g. gpt-4o-mini,gpt-4o",
    )
    p.add_argument("--out", default="tests/quality/reports", help="E2E report output directory")
    p.add_argument("--min-mean-dgs", type=float, default=None, help="Override gate threshold")
    p.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Run each scenario N times and aggregate via median dgs + majority-vote status "
        "(mitigates single-sample LLM noise). Cost scales ~linearly with N.",
    )
    p.add_argument(
        "--llm-judge",
        action="store_true",
        help="Opt-in: add one extra small LLM call per scored turn to semantically judge "
        "safety-rule violations that regex/keyword checks could miss (paraphrase evasion). "
        "$0 unless passed. Uses --judge-model (default: same as --model, or gpt-4o-mini).",
    )
    p.add_argument("--judge-model", default=None, help="Model id for --llm-judge (default: gpt-4o-mini)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    suite = args.suite.strip().lower()

    if suite == "free":
        return _run_pytest("tests/quality")

    if suite == "graph":
        return _run_pytest("tests/quality/test_graph_cases.py")

    if suite == "mcda":
        return _run_pytest("tests/quality/test_mcda_cases.py")

    if suite == "report":
        return _run_pytest("tests/quality/test_report_cases.py")

    if suite == "memory":
        return _run_pytest("tests/quality/test_memory_cases.py")

    if suite in ("e2e-smoke", "e2e-core", "e2e-all"):
        if not args.confirm:
            print("Paid E2E requires --confirm. Preview cost first:", file=sys.stderr)
            print(f"  python -m tests.quality.estimate --suite {suite}", file=sys.stderr)
            return 2

        all_scenarios = load_e2e_scenarios()
        selected = resolve_e2e(suite, all_scenarios)
        n_repeat = max(1, int(args.repeat))
        calls = estimate_llm_calls(selected) * n_repeat
        if args.llm_judge:
            # One extra small structured call per scenario (last-turn scope is the
            # default) that actually has a judgeable must_not_violate rule. Counted
            # here so --confirm's ceiling reflects the real added cost of opting in.
            from tests.quality.llm_judge import judgeable_rules

            judge_calls = sum(
                n_repeat for s in selected if judgeable_rules(list(s.expected.must_not_violate))
            )
            calls += judge_calls
        cost = estimate_cost_usd(calls)
        repeat_note = f" x{n_repeat} repeats" if n_repeat > 1 else ""
        judge_note = " +llm-judge" if args.llm_judge else ""
        print(
            f"Running {len(selected)} E2E scenarios{repeat_note}{judge_note} "
            f"(~{calls} LLM calls, ceiling ~${cost:.3f})"
        )

        model_ids = _parse_model_ids(args.model)
        policy = QualityPolicy.from_env()
        if args.min_mean_dgs is not None:
            policy = QualityPolicy(
                min_mean_dgs=args.min_mean_dgs,
                min_scenario_dgs=policy.min_scenario_dgs,
                max_errors=policy.max_errors,
                require_safety_pass=policy.require_safety_pass,
                require_no_silent_degradation=policy.require_no_silent_degradation,
            )

        comparison: list[dict[str, Any]] = []
        overall_pass = True
        for model_id in model_ids:
            if len(model_ids) > 1:
                print(f"\n--- model: {model_id} ---")
            try:
                out_path, report = run_quality_e2e(
                    selected_scenarios=selected,
                    out_dir=Path(args.out),
                    model_id=model_id,
                    policy=policy,
                    repeat=n_repeat,
                    use_llm_judge=args.llm_judge,
                    judge_model_id=(args.judge_model or model_id),
                )
                gate = evaluate_run_gate(report.get("scenarios") or [], policy=policy)
                for line in gate.summary_lines():
                    print(line)
                print(str(out_path))
                comparison.append(
                    {
                        "model_id": model_id,
                        "mean_dgs": gate.mean_dgs,
                        "gate_pass": gate.gate_pass,
                        "scenario_pass_count": gate.scenario_pass_count,
                        "scenario_total": gate.scenario_total,
                        "report_path": str(out_path),
                    }
                )
                overall_pass = overall_pass and gate.gate_pass
            except Exception as exc:
                print(f"quality e2e failed ({model_id}): {exc}", file=sys.stderr)
                comparison.append({"model_id": model_id, "error": str(exc)})
                overall_pass = False

        if len(model_ids) > 1:
            print("\n=== Multi-model comparison ===")
            print(f"{'model':<20}{'mean_dgs':>10}{'gate':>8}{'scenarios':>12}")
            for row in comparison:
                if "error" in row:
                    print(f"{row['model_id']:<20}{'ERROR':>10}  {row['error']}")
                    continue
                pass_str = "PASS" if row["gate_pass"] else "FAIL"
                scen_str = f"{row['scenario_pass_count']}/{row['scenario_total']}"
                print(f"{row['model_id']:<20}{row['mean_dgs']:>10.3f}{pass_str:>8}{scen_str:>12}")
            comparison_path = Path(args.out) / "model_comparison_latest.json"
            comparison_path.parent.mkdir(parents=True, exist_ok=True)
            comparison_path.write_text(json.dumps(comparison, indent=2), encoding="utf-8")
            print(str(comparison_path))

        return 0 if overall_pass else 1

    print(f"Unknown suite: {suite}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
