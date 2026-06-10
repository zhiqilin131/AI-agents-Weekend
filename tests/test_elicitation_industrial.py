"""Tests for industrial MCDA elicitation modules."""

from __future__ import annotations

from foresight_x.schemas import Option, TimePressure, UserState
from foresight_x.simulation.alignment_engine import (
    cross_option_discrimination,
    needs_elicitation,
)
from foresight_x.simulation.answer_validator import validate_comparative_answers, validate_scoring_clarification
from foresight_x.simulation.comparative_elicitation import (
    build_comparative_questions,
    comparative_to_scoring_clarification,
    rank_to_levels,
)
from foresight_x.simulation.elicitation_service import merge_elicitation_answers
from foresight_x.simulation.feature_schemas import OptionFeatureVector


def _opts() -> list[Option]:
    return [
        Option(option_id="a", name="Alpha", description="", key_assumptions=[], cost_of_reversal="medium"),
        Option(option_id="b", name="Beta", description="", key_assumptions=[], cost_of_reversal="medium"),
        Option(option_id="c", name="Gamma", description="", key_assumptions=[], cost_of_reversal="medium"),
    ]


def test_rank_to_levels_three_options() -> None:
    levels = rank_to_levels(["b", "a", "c"], "time_cost_level")
    assert levels["b"] == "high"
    assert levels["a"] == "medium"
    assert levels["c"] == "low"


def test_comparative_expands_to_scoring_clarification() -> None:
    out = comparative_to_scoring_clarification({"cmp:time_cost_level:rank": ["b", "a", "c"]})
    assert out["b:time_cost_level"] == "high"
    assert out["a:time_cost_level"] == "medium"
    assert out["c:time_cost_level"] == "low"


def test_merge_elicitation_combines_comparative_and_level() -> None:
    merged, cmp, errors = merge_elicitation_answers(
        scoring_clarification={"a:upside_potential_level": "high"},
        comparative_answers={"cmp:time_cost_level:rank": ["a", "b"]},
        option_ids={"a", "b"},
    )
    assert not errors
    assert merged["a:time_cost_level"] == "high"
    assert merged["b:time_cost_level"] == "low"
    assert merged["a:upside_potential_level"] == "high"
    assert "cmp:time_cost_level:rank" in cmp


def test_validate_rejects_invalid_level() -> None:
    valid, errors = validate_scoring_clarification({"a:time_cost_level": "extreme"})
    assert "a:time_cost_level" not in valid
    assert errors


def test_discrimination_zero_when_all_unknown() -> None:
    fvs = [
        OptionFeatureVector(option_id="a"),
        OptionFeatureVector(option_id="b"),
    ]
    assert cross_option_discrimination(fvs) == 0.0
    assert needs_elicitation(0.2, fvs)


def test_discrimination_positive_when_known_differ() -> None:
    fvs = [
        OptionFeatureVector(
            option_id="a",
            time_cost_level="low",
            field_status={"time_cost_level": "known"},
        ),
        OptionFeatureVector(
            option_id="b",
            time_cost_level="high",
            field_status={"time_cost_level": "known"},
        ),
    ]
    assert cross_option_discrimination(fvs) >= 0.5


def test_build_comparative_questions_when_unknown() -> None:
    fvs = [OptionFeatureVector(option_id=o.option_id) for o in _opts()]
    qs = build_comparative_questions(_opts(), fvs)
    assert qs
    assert qs[0].answer_type == "rank"
    assert len(qs[0].choices) == 3


def test_validate_comparative_duplicate_option() -> None:
    _, errors = validate_comparative_answers(
        {"cmp:time_cost_level:rank": ["a", "a"]},
        expected_option_ids={"a", "b"},
    )
    assert any("duplicate" in e for e in errors)


def test_validate_comparative_incomplete_rank() -> None:
    _, errors = validate_comparative_answers(
        {"cmp:time_cost_level:rank": ["a"]},
        expected_option_ids={"a", "b"},
    )
    assert any("incomplete_rank" in e for e in errors)


def test_comparative_skips_already_answered_features() -> None:
    fvs = [OptionFeatureVector(option_id=o.option_id) for o in _opts()]
    qs = build_comparative_questions(
        _opts(),
        fvs,
        existing_comparative={"cmp:time_cost_level:rank": ["a", "b", "c"]},
    )
    assert all(q.feature_key != "time_cost_level" for q in qs)
