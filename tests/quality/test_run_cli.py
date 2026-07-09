"""Offline unit tests for tests/quality/run.py CLI parsing helpers — $0, no API calls."""

from __future__ import annotations

import os

import pytest

from tests.quality.run import _parse_model_ids


@pytest.fixture(autouse=True)
def _clean_eval_model_env():
    saved = os.environ.pop("EVAL_MODEL_ID", None)
    yield
    if saved is not None:
        os.environ["EVAL_MODEL_ID"] = saved


def test_parse_model_ids_defaults_to_gpt4o_mini() -> None:
    assert _parse_model_ids(None) == ["gpt-4o-mini"]


def test_parse_model_ids_single_model() -> None:
    assert _parse_model_ids("gpt-4o") == ["gpt-4o"]


def test_parse_model_ids_comma_separated_for_comparison() -> None:
    assert _parse_model_ids("gpt-4o-mini, gpt-4o ,gpt-4.1-mini") == ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]


def test_parse_model_ids_ignores_empty_segments() -> None:
    assert _parse_model_ids("gpt-4o-mini,,  ,gpt-4o") == ["gpt-4o-mini", "gpt-4o"]


def test_parse_model_ids_falls_back_to_env_var() -> None:
    os.environ["EVAL_MODEL_ID"] = "gpt-4o"
    assert _parse_model_ids(None) == ["gpt-4o"]
