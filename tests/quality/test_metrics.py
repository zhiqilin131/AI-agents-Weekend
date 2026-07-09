"""Offline unit tests for tests/quality/metrics.py additions — $0, no API calls."""

from __future__ import annotations

import os

import pytest

from tests.quality.loaders import load_e2e_scenarios
from tests.quality.metrics import compute_dgs, dgs_weights, estimate_cost_usd_weighted


@pytest.fixture(autouse=True)
def _clean_dgs_weight_env():
    keys = [
        "QUALITY_DGS_WEIGHT_MEMORY",
        "QUALITY_DGS_WEIGHT_GRAPH",
        "QUALITY_DGS_WEIGHT_MCDA",
        "QUALITY_DGS_WEIGHT_REPORT",
        "QUALITY_DGS_WEIGHT_RECOMMENDATION",
    ]
    saved = {k: os.environ.pop(k, None) for k in keys}
    yield
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v
        else:
            os.environ.pop(k, None)


def test_dgs_weights_default_matches_documented_split_and_sums_to_one() -> None:
    w = dgs_weights()
    assert w == pytest.approx({"memory": 0.30, "graph": 0.25, "mcda": 0.20, "report": 0.15, "recommendation": 0.10})
    assert sum(w.values()) == pytest.approx(1.0)


def test_dgs_weights_env_override_is_renormalized() -> None:
    """A partial override must not silently change the total scale of compute_dgs —
    e.g. doubling one weight without renormalizing would let DGS exceed 1.0."""
    os.environ["QUALITY_DGS_WEIGHT_MEMORY"] = "0.60"
    w = dgs_weights()
    assert sum(w.values()) == pytest.approx(1.0)
    assert w["memory"] > 0.30  # still the largest weight after renormalization


def test_compute_dgs_uses_current_weights() -> None:
    perfect = compute_dgs(memory_score=1.0, graph_score=1.0, mcda_score=1.0, report_score=1.0, recommendation_score=1.0)
    assert perfect == 1.0

    os.environ["QUALITY_DGS_WEIGHT_MEMORY"] = "1.0"
    os.environ["QUALITY_DGS_WEIGHT_GRAPH"] = "0.0"
    os.environ["QUALITY_DGS_WEIGHT_MCDA"] = "0.0"
    os.environ["QUALITY_DGS_WEIGHT_REPORT"] = "0.0"
    os.environ["QUALITY_DGS_WEIGHT_RECOMMENDATION"] = "0.0"
    memory_only = compute_dgs(
        memory_score=0.5, graph_score=0.0, mcda_score=0.0, report_score=0.0, recommendation_score=0.0
    )
    assert memory_only == 0.5


def test_estimate_cost_usd_weighted_scales_with_category_mix() -> None:
    scenarios = load_e2e_scenarios()
    cross_session = [s for s in scenarios if s.category == "cross_session"]
    shadow = [s for s in scenarios if s.category == "shadow"]
    assert cross_session and shadow, "fixture set must include both categories to test the weighting"

    cs_cost = estimate_cost_usd_weighted(cross_session)
    sh_cost = estimate_cost_usd_weighted(shadow)
    # cross_session's token-scale multiplier (1.3) exceeds shadow's (0.6), so per
    # equivalent raw call count, its weighted estimate should be pulled higher
    # relative to the naive (raw) estimate — assert the weighted/raw ratio itself,
    # since scenario counts/call counts differ between categories.
    cs_ratio = cs_cost["token_weighted_llm_calls"] / cs_cost["raw_llm_calls"]
    sh_ratio = sh_cost["token_weighted_llm_calls"] / sh_cost["raw_llm_calls"]
    assert cs_ratio > sh_ratio


def test_estimate_cost_usd_weighted_repeat_scales_linearly() -> None:
    scenarios = load_e2e_scenarios()[:2]
    once = estimate_cost_usd_weighted(scenarios, repeat=1)
    thrice = estimate_cost_usd_weighted(scenarios, repeat=3)
    assert thrice["raw_llm_calls"] == once["raw_llm_calls"] * 3
    assert thrice["token_weighted_cost_usd"] == pytest.approx(once["token_weighted_cost_usd"] * 3, rel=0.01)
