from foresight_x.decision_algorithms.mcda import DEFAULT_CRITERIA, evaluate_options_mcda
from foresight_x.decision_algorithms.schemas import DecisionOption


def _opts():
    return [
        DecisionOption(id="option_1", title="Option 1", description="stable path", assumptions=["a"]),
        DecisionOption(id="option_2", title="Option 2", description="high upside but uncertain", assumptions=["a", "b"]),
        DecisionOption(id="option_3", title="Option 3", description="low effort", assumptions=[]),
    ]


def test_mcda_weighted_sum_deterministic():
    out1 = evaluate_options_mcda(_opts(), criteria=DEFAULT_CRITERIA, method="weighted_sum")
    out2 = evaluate_options_mcda(_opts(), criteria=DEFAULT_CRITERIA, method="weighted_sum")
    assert [x.option_id for x in out1.ranked_options] == [x.option_id for x in out2.ranked_options]


def test_mcda_topsis_fallback_rank_exists():
    out = evaluate_options_mcda(_opts(), method="topsis")
    assert out.ranked_options
    assert out.ranked_options[0].rank == 1


def test_cost_criteria_present_and_tracked():
    out = evaluate_options_mcda(_opts(), method="topsis")
    assert "stress_load" in out.criteria_weights
    assert "regret_risk" in out.criteria_weights

