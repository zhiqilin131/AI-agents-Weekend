"""Offline unit tests for tests/quality/llm_judge.py — mocks the LLM call, $0, no API."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from tests.quality.llm_judge import RULE_DESCRIPTIONS, judge_safety_semantic, judgeable_rules


def test_judgeable_rules_filters_to_known_semantic_rules() -> None:
    assert judgeable_rules(["not_therapy", "max_elicitation_rounds", "no_emergency"]) == [
        "not_therapy",
        "no_emergency",
    ]


def test_judgeable_rules_empty_when_nothing_matches() -> None:
    assert judgeable_rules(["max_elicitation_rounds"]) == []


def test_judge_safety_semantic_short_circuits_with_no_known_rules() -> None:
    result = judge_safety_semantic(
        user_input="hi", system_output="hello", rules=["max_elicitation_rounds"]
    )
    assert result["available"] is False
    assert result["error"] == "no_known_rules"


class _FakeVerdict:
    def __init__(self, rule: str, violated: bool, rationale: str = "") -> None:
        self.rule = rule
        self.violated = violated
        self.rationale = rationale


class _FakeOutput:
    def __init__(self, verdicts) -> None:
        self.verdicts = verdicts


def test_judge_safety_semantic_parses_llm_output_into_verdicts() -> None:
    fake_output = _FakeOutput([_FakeVerdict("not_therapy", True, "gave a diagnosis")])
    with patch("foresight_x.orchestration.llm_factory.build_openai_llm", return_value=object()), patch(
        "foresight_x.structured_predict.structured_predict", return_value=fake_output
    ):
        result = judge_safety_semantic(
            user_input="I feel anxious",
            system_output="You have generalized anxiety disorder, take these steps to treat it.",
            rules=["not_therapy"],
        )
    assert result["available"] is True
    assert result["verdicts"]["not_therapy"]["violated"] is True


def test_judge_safety_semantic_degrades_gracefully_on_exception() -> None:
    with patch("foresight_x.orchestration.llm_factory.build_openai_llm", side_effect=RuntimeError("boom")):
        result = judge_safety_semantic(user_input="hi", system_output="hello", rules=["not_therapy"])
    assert result["available"] is False
    assert "boom" in result["error"]


def test_all_rule_descriptions_are_non_empty() -> None:
    assert RULE_DESCRIPTIONS
    for rule, desc in RULE_DESCRIPTIONS.items():
        assert desc.strip(), f"{rule} has an empty description"
