"""Cost preview for paid quality E2E suites (manual invoke)."""

from __future__ import annotations

import argparse
import sys

from tests.quality.loaders import load_e2e_scenarios, resolve_e2e
from tests.quality.metrics import estimate_cost_usd, estimate_cost_usd_weighted, estimate_llm_calls


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Estimate cost for quality E2E benchmark suites.")
    p.add_argument(
        "--suite",
        default="e2e-core",
        choices=["e2e-smoke", "e2e-core", "e2e-all", "smoke", "core", "all"],
        help="Scenario set to estimate",
    )
    p.add_argument("--margin", type=float, default=0.30, help="Safety margin on top of baseline ratio")
    p.add_argument("--confirm", action="store_true", help="Print confirmation token for run.py")
    p.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Match --repeat N you plan to pass to run.py; cost scales ~linearly with N",
    )
    p.add_argument(
        "--llm-judge",
        action="store_true",
        help="Match --llm-judge you plan to pass to run.py; adds ~1 call per scenario with a judgeable rule",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    all_scenarios = load_e2e_scenarios()
    if not all_scenarios:
        print("No E2E scenarios found under tests/quality/e2e/", file=sys.stderr)
        return 2

    selected = resolve_e2e(args.suite, all_scenarios)
    n_repeat = max(1, int(args.repeat))
    calls = estimate_llm_calls(selected) * n_repeat
    judge_calls = 0
    if args.llm_judge:
        from tests.quality.llm_judge import judgeable_rules

        judge_calls = sum(n_repeat for s in selected if judgeable_rules(list(s.expected.must_not_violate)))
        calls += judge_calls
    cost = estimate_cost_usd(calls, margin=args.margin)
    weighted = estimate_cost_usd_weighted(selected, margin=args.margin, repeat=n_repeat)

    print("Quality benchmark cost estimate")
    print(f"  suite:        {args.suite}")
    print(f"  scenarios:    {len(selected)}" + (f" x{n_repeat} repeats" if n_repeat > 1 else ""))
    print(f"  llm_calls:    ~{calls} (flat, call-count proxy)" + (f", incl. +{judge_calls} llm-judge" if judge_calls else ""))
    print(f"  cost_ceiling: ~${cost:.3f} USD (gpt-4o-mini baseline + {int(args.margin * 100)}% margin)")
    # Flat call-count costing assumes every call is equally expensive; this can
    # under/over-estimate when the suite's category mix (e.g. cross_session's
    # longer multi-turn context) differs from the baseline run's mix. See
    # tests.quality.metrics.estimate_cost_usd_weighted for the caveats.
    print(
        f"  token-weighted estimate: ~${weighted['token_weighted_cost_usd']:.3f} USD "
        f"(heuristic per-category scale, not measured tokens)"
    )
    print()
    for s in selected:
        est = s.metadata.estimated_llm_calls or "avg"
        print(f"  - {s.id} ({s.category}, persona={s.persona_id}, est_calls={est})")

    if args.confirm:
        print()
        print(f"To run: python -m tests.quality.run --suite {args.suite} --confirm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
