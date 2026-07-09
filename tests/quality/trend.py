"""Print the DGS trend history (tests/quality/dgs_history.jsonl) for calibration review.

Usage:
    python -m tests.quality.trend
    python -m tests.quality.trend --last 30
    python -m tests.quality.trend --scenario fict-career-01-counter-offer-deadline

$0, no API calls — reads the committed history file only.
"""

from __future__ import annotations

import argparse

from tests.quality.history import load_dgs_history


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Show DGS run history for calibration/trend review.")
    p.add_argument("--last", type=int, default=15, help="Show at most the last N runs")
    p.add_argument("--scenario", default=None, help="Also break out this scenario's dgs across runs")
    args = p.parse_args(argv)

    rows = load_dgs_history()
    if not rows:
        print("No history yet (tests/quality/dgs_history.jsonl is empty). Run a paid E2E suite first.")
        return 0

    rows = rows[-args.last :]
    print(f"{'timestamp':<21}{'model':<18}{'repeat':>7}{'mean_dgs':>10}{'pass':>6}{'scenarios':>12}")
    for r in rows:
        pass_count = r.get("scenario_pass_count", 0)
        total = r.get("scenario_total", 0)
        print(
            f"{str(r.get('timestamp', ''))[:19]:<21}"
            f"{str(r.get('model_id', ''))[:17]:<18}"
            f"{r.get('repeat', 1):>7}"
            f"{float(r.get('mean_dgs') or 0):>10.3f}"
            f"{'Y' if r.get('gate_pass') else 'N':>6}"
            f"{f'{pass_count}/{total}':>12}"
        )

    if args.scenario:
        print(f"\n--- {args.scenario} dgs across runs ---")
        for r in rows:
            val = (r.get("per_scenario_dgs") or {}).get(args.scenario)
            if val is None:
                continue
            print(f"{str(r.get('timestamp', ''))[:19]:<21} dgs={val:.3f} model={r.get('model_id')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
