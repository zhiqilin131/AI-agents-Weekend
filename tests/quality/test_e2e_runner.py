"""Offline unit tests for e2e_runner helpers — $0, no API, no paid pipeline run."""

from __future__ import annotations

from tests.quality.e2e_runner import _EVAL_ENV_KEYS, _scenarios_need_graph_enabled
from tests.quality.loaders import load_e2e_scenarios


def test_scenarios_need_graph_enabled_false_by_default() -> None:
    """None of the shipped scenarios set expect_graph_influence: true today, so a
    normal run must NOT force GRAPH_ENABLED=1 (that would add real Graphiti/API
    cost + latency nobody asked for)."""
    scenarios = load_e2e_scenarios()
    assert not _scenarios_need_graph_enabled(scenarios)


def test_scenarios_need_graph_enabled_true_when_any_scenario_opts_in() -> None:
    scenarios = load_e2e_scenarios()
    target = scenarios[0].model_copy(
        update={"expected": scenarios[0].expected.model_copy(update={"expect_graph_influence": True})}
    )
    assert _scenarios_need_graph_enabled([target, *scenarios[1:]])


def test_graph_enabled_is_snapshotted_and_restored() -> None:
    """GRAPH_ENABLED must be in the env keys captured/restored around a run —
    otherwise auto-enabling it for an expect_graph_influence scenario would leak
    'GRAPH_ENABLED=1' into the environment past the end of that run (affecting
    every subsequent test/process in the same session)."""
    assert "GRAPH_ENABLED" in _EVAL_ENV_KEYS
