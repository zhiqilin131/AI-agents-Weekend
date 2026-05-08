from __future__ import annotations

from foresight_x.decision_algorithms.schemas import (
    AgilityPreview,
    DecisionInfluenceGraph,
    ExecutionTask,
    MCDAResult,
    RobustnessResult,
)


def build_agility_preview(
    selected_option_id: str,
    influence_graph: DecisionInfluenceGraph,
    mcda_result: MCDAResult,
    robustness_result: RobustnessResult,
    trace,
) -> AgilityPreview:
    ranked = next((r for r in mcda_result.ranked_options if r.option_id == selected_option_id), None)
    option = next((o for o in influence_graph.options if o.id == selected_option_id), None)
    option_title = option.title if option else selected_option_id
    headline = (
        f"Robust if you protect focused time this week ({option_title})"
        if robustness_result.robustness_label != "fragile"
        else f"Promising but fragile unless monitored closely ({option_title})"
    )
    likely = [s.consequence_summary for s in robustness_result.plausible_paths[:3]]
    steps: list[ExecutionTask] = influence_graph.action_candidates[:3]
    if not steps:
        steps = [
            ExecutionTask(id="task_1", title="Clarify immediate execution scope", duration_minutes=45, priority="high"),
            ExecutionTask(id="task_2", title="Schedule first protected work block", duration_minutes=60, priority="high"),
            ExecutionTask(id="task_3", title="Run progress checkpoint", duration_minutes=30, priority="medium"),
        ]
    hidden_assumptions = option.assumptions[:3] if option else []
    if not hidden_assumptions:
        hidden_assumptions = [
            "You can reserve uninterrupted time blocks this week.",
            "Dependencies respond within planned timelines.",
        ]
    return AgilityPreview(
        selected_option_id=selected_option_id,
        headline=headline,
        summary=(
            f"{option_title} ranks #{ranked.rank if ranked else '?'} by MCDA and is "
            f"{robustness_result.robustness_label.replace('_', ' ')} across plausible paths."
        ),
        likely_consequences=likely,
        workload_impact=(
            "Front-loaded workload for the first 3-5 days; protect at least one deep-work block daily."
        ),
        risk_windows=robustness_result.vulnerability_conditions[:3],
        reversibility=robustness_result.reversibility,
        hidden_assumptions=hidden_assumptions,
        first_steps=steps,
        review_checkpoint=robustness_result.review_checkpoint,
    )

