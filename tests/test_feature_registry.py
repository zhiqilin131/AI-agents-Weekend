"""Tests for MCDA feature registry."""

from __future__ import annotations

from foresight_x.simulation.feature_registry import (
    comparative_priority_keys,
    registry_export,
)
from foresight_x.simulation.feature_schemas import CRITICAL_FEATURE_KEYS
from foresight_x.simulation.feature_schemas import OptionFeatureVector


def test_registry_covers_all_critical_keys() -> None:
    exported = registry_export()
    assert exported["critical_feature_keys"] == list(CRITICAL_FEATURE_KEYS)
    for key in CRITICAL_FEATURE_KEYS:
        assert key in exported["labels"]
        assert key in exported["question_templates"]
        assert key in exported["polarity"]


def test_comparative_priority_prefers_low_spread_unknown() -> None:
    fvs = [
        OptionFeatureVector(
            option_id="a",
            time_cost_level="low",
            upside_potential_level="unknown",
            field_status={"time_cost_level": "known", "upside_potential_level": "unknown"},
        ),
        OptionFeatureVector(
            option_id="b",
            time_cost_level="high",
            upside_potential_level="unknown",
            field_status={"time_cost_level": "known", "upside_potential_level": "unknown"},
        ),
    ]
    keys = comparative_priority_keys(fvs, missing_only=True)
    assert keys
    assert "upside_potential_level" in keys
