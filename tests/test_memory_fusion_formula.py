from __future__ import annotations

import pytest

from foresight_x.config import load_settings
from foresight_x.retrieval.memory import (
    _classify_query_type,
    _dynamic_graph_fusion_alpha,
    _weighted_minmax_fusion,
)
from foresight_x.schemas import UserState


def _state(raw_input: str, *, decision_type: str = "general") -> UserState:
    return UserState(
        raw_input=raw_input,
        goals=[],
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type=decision_type,
        reversibility="partial",
    )


def test_weighted_minmax_fusion_alpha_zero_uses_base_only() -> None:
    out = _weighted_minmax_fusion([0.1, 0.3, 0.5], [0.9, 0.2, 0.1], alpha=0.0)
    assert out[0] < out[1] < out[2]


def test_weighted_minmax_fusion_alpha_one_uses_graph_only() -> None:
    out = _weighted_minmax_fusion([0.1, 0.3, 0.5], [0.1, 0.8, 0.2], alpha=1.0)
    assert out[1] > out[2] > out[0]


def test_weighted_minmax_fusion_without_graph_signal_falls_back_to_base() -> None:
    out = _weighted_minmax_fusion([0.2, 0.4, 0.6], [0.0, 0.0, 0.0], alpha=0.9)
    assert out[0] < out[1] < out[2]


def test_query_type_classifier_examples() -> None:
    assert _classify_query_type(_state("What are the latest World Cup stats this week?")) == "factual"
    assert _classify_query_type(_state("What do you remember about my preferences?")) == "personal"
    assert _classify_query_type(_state("Should I prioritize internship or World Cup?", decision_type="career")) == "planning"


def test_dynamic_graph_alpha_uses_query_type_multipliers() -> None:
    s = load_settings().model_copy(
        update={
            "graph_fusion_weight": 0.4,
            "graph_fusion_dynamic_enabled": True,
            "graph_fusion_mult_factual": 0.5,
            "graph_fusion_mult_personal": 1.5,
            "graph_fusion_mult_planning": 1.0,
            "graph_fusion_mult_general": 0.75,
        }
    )
    factual = _dynamic_graph_fusion_alpha(_state("What happened in the latest World Cup standings?"), s)
    personal = _dynamic_graph_fusion_alpha(_state("What do you remember about my relationship preferences?"), s)
    planning = _dynamic_graph_fusion_alpha(_state("Should I focus on internship or World Cup?", decision_type="career"), s)
    assert factual == pytest.approx(0.2)
    assert personal == pytest.approx(0.6)
    assert planning == pytest.approx(0.4)
