from __future__ import annotations

from statistics import mean

from foresight_x.decision_algorithms.schemas import (
    ConsequenceScenario,
    DecisionInfluenceGraph,
    DecisionOption,
    MCDAResult,
    RobustnessResult,
)


def _scenario_template(option: DecisionOption, label: str) -> ConsequenceScenario:
    if label == "optimistic":
        return ConsequenceScenario(
            option_id=option.id,
            label="optimistic",
            consequence_summary=f"{option.title}: momentum builds quickly with manageable trade-offs.",
            stress_level="low",
            workload_pressure="medium",
            downside_severity="low",
            reversibility="high",
            regret_risk="low",
            recovery_path="Minor adjustments only.",
            early_warning_signals=["scope creep starts"],
            review_checkpoint="3 days",
        )
    if label == "downside":
        return ConsequenceScenario(
            option_id=option.id,
            label="downside",
            consequence_summary=f"{option.title}: delays accumulate and commitments fragment.",
            stress_level="high",
            workload_pressure="high",
            downside_severity="high",
            reversibility="medium",
            regret_risk="high",
            recovery_path="Reduce scope and restore protected blocks.",
            early_warning_signals=["two missed blocks", "deadline slip"],
            review_checkpoint="48 hours",
        )
    if label == "high_stress":
        return ConsequenceScenario(
            option_id=option.id,
            label="high_stress",
            consequence_summary=f"{option.title}: execution possible but cognitive load spikes.",
            stress_level="high",
            workload_pressure="high",
            downside_severity="medium",
            reversibility="medium",
            regret_risk="medium",
            recovery_path="Pause non-critical tasks and re-sequence.",
            early_warning_signals=["rapid context switching"],
            review_checkpoint="72 hours",
        )
    if label == "delayed_progress":
        return ConsequenceScenario(
            option_id=option.id,
            label="delayed_progress",
            consequence_summary=f"{option.title}: progress is slower but still recoverable.",
            stress_level="medium",
            workload_pressure="medium",
            downside_severity="medium",
            reversibility="high",
            regret_risk="medium",
            recovery_path="Pull next steps forward and shorten feedback loops.",
            early_warning_signals=["first milestone slip"],
            review_checkpoint="1 week",
        )
    return ConsequenceScenario(
        option_id=option.id,
        label="realistic",
        consequence_summary=f"{option.title}: moderate progress with manageable schedule pressure.",
        stress_level="medium",
        workload_pressure="medium",
        downside_severity="medium",
        reversibility="high",
        regret_risk="medium",
        recovery_path="Replan after checkpoint.",
        early_warning_signals=["block fragmentation"],
        review_checkpoint="5 days",
    )


def generate_consequence_scenarios(
    option: DecisionOption,
    influence_graph: DecisionInfluenceGraph,
    trace=None,
    n_scenarios: int = 4,
) -> list[ConsequenceScenario]:
    labels = ["optimistic", "realistic", "downside", "high_stress", "delayed_progress"][: max(3, min(5, n_scenarios))]
    return [_scenario_template(option, x) for x in labels]


def _level_num(x: str) -> float:
    return {"low": 0.2, "medium": 0.55, "high": 0.9}.get(x, 0.55)


def compute_regret_proxy(option_scenario_utilities: list[float], best_scenario_utility: float) -> float:
    if not option_scenario_utilities:
        return 0.0
    regrets = [max(0.0, best_scenario_utility - u) for u in option_scenario_utilities]
    return max(regrets)


def evaluate_robustness(
    option: DecisionOption,
    scenarios: list[ConsequenceScenario],
    mcda_result: MCDAResult | None = None,
) -> RobustnessResult:
    if not scenarios:
        scenarios = [_scenario_template(option, "realistic")]
    downside_max = max(_level_num(s.downside_severity) for s in scenarios)
    rev_avg = mean(_level_num(s.reversibility) for s in scenarios)
    stress_avg = mean(_level_num(s.stress_level) for s in scenarios)
    utilities = [1.0 - 0.5 * _level_num(s.downside_severity) - 0.3 * _level_num(s.regret_risk) for s in scenarios]
    best = max(utilities)
    regret_proxy = compute_regret_proxy(utilities, best)

    if downside_max < 0.45 and regret_proxy < 0.2:
        label = "robust"
    elif downside_max < 0.8:
        label = "robust_with_monitoring"
    else:
        label = "fragile"

    downside_txt = "low" if downside_max < 0.4 else "medium" if downside_max < 0.75 else "high"
    rev_txt = "high" if rev_avg > 0.7 else "medium" if rev_avg > 0.4 else "low"
    rr_txt = "low" if regret_proxy < 0.15 else "low_to_medium" if regret_proxy < 0.3 else "medium_to_high"
    warnings = sorted({w for s in scenarios for w in s.early_warning_signals})[:5]
    vuln = []
    if stress_avg > 0.7:
        vuln.append("High stress accumulation across plausible paths.")
    if downside_max > 0.75:
        vuln.append("Downside path contains severe schedule/quality degradation.")
    if not vuln:
        vuln.append("Primary risk is execution fragmentation, not impossibility.")

    top_checkpoint = scenarios[0].review_checkpoint or "1 week"
    summary = f"{option.title} is {label.replace('_', ' ')} with {downside_txt} downside exposure and {rev_txt} reversibility."
    return RobustnessResult(
        option_id=option.id,
        robustness_label=label,
        summary=summary,
        plausible_paths=scenarios,
        vulnerability_conditions=vuln,
        downside_exposure=downside_txt,
        reversibility=rev_txt,
        regret_risk=rr_txt,
        review_checkpoint=f"Review after {top_checkpoint}",
        early_warning_signals=warnings,
        max_regret_proxy=round(regret_proxy, 4),
    )

