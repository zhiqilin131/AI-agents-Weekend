"""Industrial quality gates for paid E2E runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class QualityPolicy:
    """Pass/fail policy for scored E2E benchmark runs."""

    min_mean_dgs: float = 0.72
    min_scenario_dgs: float = 0.55
    max_errors: int = 0
    require_safety_pass: bool = True
    require_no_silent_degradation: bool = True

    @classmethod
    def from_env(cls) -> QualityPolicy:
        import os

        return cls(
            min_mean_dgs=float(os.getenv("QUALITY_MIN_MEAN_DGS", "0.72")),
            min_scenario_dgs=float(os.getenv("QUALITY_MIN_SCENARIO_DGS", "0.55")),
        )


DEFAULT_POLICY = QualityPolicy()


@dataclass
class ScenarioScoreResult:
    scenario_id: str
    dgs: float
    components: dict[str, float]
    hard_gate_failures: list[str] = field(default_factory=list)
    status: str = "pass"
    metrics: dict[str, Any] = field(default_factory=dict)


@dataclass
class RunGateResult:
    gate_pass: bool
    mean_dgs: float
    scenario_pass_count: int
    scenario_total: int
    errors: int
    failures: list[str] = field(default_factory=list)
    policy: QualityPolicy = DEFAULT_POLICY
    quarantined: list[dict[str, Any]] = field(default_factory=list)
    high_variance: list[dict[str, Any]] = field(default_factory=list)

    def summary_lines(self) -> list[str]:
        lines = [
            "=== Quality E2E Gate ===",
            f"mean_dgs:     {self.mean_dgs:.3f} (min {self.policy.min_mean_dgs})",
            f"scenarios:    {self.scenario_pass_count}/{self.scenario_total} pass",
            f"errors:       {self.errors} (max {self.policy.max_errors})",
            f"gate:         {'PASS' if self.gate_pass else 'FAIL'}",
        ]
        if self.quarantined:
            lines.append(f"quarantined:  {len(self.quarantined)} (known_backend_issue, excluded from gate)")
            for q in self.quarantined[:8]:
                lines.append(f"  - {q['scenario_id']}: dgs={q['dgs']:.3f} ({q['known_backend_issue']})")
        if self.high_variance:
            # Informational only (never blocks the gate): with --repeat > 1, a wide
            # dgs spread across repeats means the LLM's behavior is noisy for this
            # scenario, not necessarily wrong — worth a human look, not an auto-fail.
            lines.append(f"high_variance: {len(self.high_variance)} scenario(s) with dgs_spread > 0.15 across repeats")
            for v in self.high_variance[:8]:
                lines.append(f"  - {v['scenario_id']}: dgs_values={v['dgs_values']} spread={v['dgs_spread']:.3f}")
        for f in self.failures[:8]:
            lines.append(f"  - {f}")
        return lines


def evaluate_run_gate(
    scenario_rows: list[dict[str, Any]],
    *,
    policy: QualityPolicy | None = None,
) -> RunGateResult:
    """Score/gate all scenarios except those with expected.known_backend_issue set —
    those are quarantined: still scored and fully visible in the report (never
    silently dropped), but excluded from the pass-count / mean_dgs / gate_pass
    computation so a known, already-tracked backend limitation can't block
    every other release forever. A scenario without the field behaves exactly
    as before.
    """
    pol = policy or DEFAULT_POLICY
    failures: list[str] = []
    dgs_vals: list[float] = []
    pass_count = 0

    quarantined_rows = [row for row in scenario_rows if row.get("known_backend_issue")]
    active_rows = [row for row in scenario_rows if not row.get("known_backend_issue")]
    errors = sum(1 for row in active_rows if row.get("status") == "error")

    for row in active_rows:
        sid = str(row.get("scenario_id", ""))
        metrics = row.get("metrics") or {}
        dgs = float(metrics.get("dgs", 0.0))
        dgs_vals.append(dgs)
        row_failures = list(row.get("hard_gate_failures") or [])
        if row.get("status") == "error":
            failures.append(f"{sid}: pipeline error")
            continue
        if dgs < pol.min_scenario_dgs:
            failures.append(f"{sid}: dgs {dgs:.3f} < {pol.min_scenario_dgs}")
        elif not row_failures:
            pass_count += 1
        else:
            failures.append(f"{sid}: {', '.join(row_failures)}")

    mean_dgs = sum(dgs_vals) / len(dgs_vals) if dgs_vals else 0.0
    if mean_dgs < pol.min_mean_dgs:
        failures.insert(0, f"mean_dgs {mean_dgs:.3f} < {pol.min_mean_dgs}")
    if errors > pol.max_errors:
        failures.insert(0, f"errors {errors} > {pol.max_errors}")

    gate_pass = (
        errors <= pol.max_errors
        and mean_dgs >= pol.min_mean_dgs
        and all(float((r.get("metrics") or {}).get("dgs", 0)) >= pol.min_scenario_dgs for r in active_rows if r.get("status") != "error")
        and all(not (r.get("hard_gate_failures") or []) for r in active_rows if r.get("status") != "error")
    )

    quarantined_summary = [
        {
            "scenario_id": str(row.get("scenario_id", "")),
            "dgs": float((row.get("metrics") or {}).get("dgs", 0.0)),
            "known_backend_issue": row.get("known_backend_issue"),
        }
        for row in quarantined_rows
    ]

    high_variance_summary = [
        {
            "scenario_id": str(row.get("scenario_id", "")),
            "dgs_values": (row.get("metrics") or {}).get("dgs_values", []),
            "dgs_spread": float((row.get("metrics") or {}).get("dgs_spread", 0.0)),
        }
        for row in scenario_rows
        if (row.get("metrics") or {}).get("high_variance")
    ]

    return RunGateResult(
        gate_pass=gate_pass,
        mean_dgs=round(mean_dgs, 4),
        scenario_pass_count=pass_count,
        scenario_total=len(active_rows),
        errors=errors,
        failures=failures,
        policy=pol,
        quarantined=quarantined_summary,
        high_variance=high_variance_summary,
    )
