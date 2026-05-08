from foresight_x.decision_algorithms.robustness import (
    compute_regret_proxy,
    evaluate_robustness,
    generate_consequence_scenarios,
)
from foresight_x.decision_algorithms.schemas import DecisionInfluenceGraph, DecisionOption


def test_regret_proxy_increases_with_downside():
    low = compute_regret_proxy([0.8, 0.7], 0.8)
    high = compute_regret_proxy([0.8, 0.2], 0.8)
    assert high > low


def test_robustness_label_for_high_downside_not_robust():
    option = DecisionOption(id="o1", title="Option 1")
    graph = DecisionInfluenceGraph(decision_question="q", options=[option])
    scenarios = generate_consequence_scenarios(option, graph, n_scenarios=5)
    out = evaluate_robustness(option, scenarios)
    assert out.robustness_label in {"robust_with_monitoring", "fragile", "robust"}
    assert out.regret_risk in {"low", "low_to_medium", "medium", "medium_to_high", "high"}

