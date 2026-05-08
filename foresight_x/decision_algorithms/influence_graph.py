from __future__ import annotations

from foresight_x.decision_algorithms.schemas import (
    DecisionConstraint,
    DecisionInfluenceGraph,
    DecisionOption,
    DecisionUncertainty,
    DecisionValue,
    ExecutionTask,
)


def build_influence_graph_from_trace(trace) -> DecisionInfluenceGraph:
    options = [
        DecisionOption(
            id=o.option_id,
            title=o.name,
            description=o.description,
            assumptions=list(o.key_assumptions),
        )
        for o in trace.options
    ]
    values = [
        DecisionValue(id="value_alignment", name="value alignment", weight=0.2, description="Fit with user values/goals"),
        DecisionValue(id="feasibility", name="feasibility", weight=0.2, description="Practical executability"),
        DecisionValue(id="reversibility", name="reversibility", weight=0.15, description="Cost of undoing"),
        DecisionValue(id="downside", name="downside protection", weight=0.2, description="Protection under adverse path"),
        DecisionValue(id="schedule", name="schedule fit", weight=0.15, description="Fit with available time"),
        DecisionValue(id="regret", name="regret minimization", weight=0.1, description="Minimize future regret"),
    ]
    uncertainties = [
        DecisionUncertainty(
            id=f"unc_{i+1}",
            name=bias,
            description="Potential decision distortion risk surfaced by rationality module.",
            direction="higher_is_worse",
        )
        for i, bias in enumerate(getattr(trace.rationality, "detected_biases", [])[:6])
    ] or [
        DecisionUncertainty(
            id="unc_1",
            name="workload pressure",
            description="Time and cognitive load can reduce execution quality.",
            direction="higher_is_worse",
        )
    ]
    constraints = []
    if getattr(trace.user_state, "deadline_hint", None):
        constraints.append(
            DecisionConstraint(
                id="c_deadline",
                type="time",
                description=f"deadline hint: {trace.user_state.deadline_hint}",
            )
        )
    constraints.append(
        DecisionConstraint(
            id="c_time_window",
            type="time_window",
            description="Default working hours 09:00-22:00 for execution scheduling.",
        )
    )
    action_candidates = [
        ExecutionTask(
            id=f"task_{idx+1}",
            title=na.action,
            duration_minutes=60,
            priority="high" if idx == 0 else "medium",
            deadline_hint=na.deadline,
            linked_option_id=getattr(trace.recommendation, "chosen_option_id", None),
        )
        for idx, na in enumerate(trace.recommendation.next_actions[:6])
    ]
    return DecisionInfluenceGraph(
        decision_question=trace.user_state.raw_input,
        options=options,
        uncertainties=uncertainties,
        values=values,
        constraints=constraints,
        action_candidates=action_candidates,
    )


def optionally_build_pyagrum_influence_diagram(graph: DecisionInfluenceGraph):
    """Optional advanced path. JSON graph remains source-of-truth."""
    try:
        import pyAgrum as gum  # type: ignore
    except Exception:
        return None
    # Keep this intentionally minimal; pyAgrum can be expanded later without
    # blocking core functionality.
    diag = gum.InfluenceDiagram()
    node_ids = {}
    for v in graph.values:
        node_ids[v.id] = diag.addChanceNode(gum.LabelizedVariable(v.id, v.name, 2))
    for o in graph.options:
        node_ids[o.id] = diag.addDecisionNode(gum.LabelizedVariable(o.id, o.title, 2))
    return diag

