"""TavilyGateway tests — mock `TavilyClient`, no network."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from foresight_x.retrieval.tavily_client import (
    TAVILY_MAX_QUERY_CHARS,
    TavilyGateway,
    build_tavily_query_for_decision,
)
from foresight_x.schemas import Reversibility, TimePressure, UserState


@pytest.fixture
def tavily_response() -> dict:
    return {
        "results": [
            {
                "title": "Example Corp hiring",
                "content": "Company X expanded internship program in 2026.",
                "url": "https://example.com/news",
            },
            {
                "title": "",
                "content": "Second hit without title.",
                "url": None,
            },
        ]
    }


def test_search_as_facts_maps_to_schema(tavily_response: dict) -> None:
    mock_client = MagicMock()
    mock_client.search.return_value = tavily_response
    with patch("foresight_x.retrieval.tavily_client.TavilyClient", return_value=mock_client):
        gw = TavilyGateway(api_key="tvly-test")

    facts = gw.search_as_facts("internship deadline")
    assert len(facts) == 2
    assert facts[0].source_url == "https://example.com/news"
    assert "Company X" in facts[0].text
    mock_client.search.assert_called_once()
    call_kw = mock_client.search.call_args.kwargs
    assert call_kw.get("search_depth") == "advanced"


def test_requires_api_key() -> None:
    with pytest.raises(ValueError, match="TAVILY_API_KEY"):
        TavilyGateway(api_key="")


def test_long_query_truncated_for_tavily_api(tavily_response: dict) -> None:
    mock_client = MagicMock()
    mock_client.search.return_value = tavily_response
    with patch("foresight_x.retrieval.tavily_client.TavilyClient", return_value=mock_client):
        gw = TavilyGateway(api_key="tvly-test")
    long_q = "x" * 2000
    gw.search_as_facts(long_q)
    passed = mock_client.search.call_args[0][0]
    assert len(passed) <= TAVILY_MAX_QUERY_CHARS


def test_build_tavily_query_excludes_profile_by_default() -> None:
    us = UserState(
        raw_input="Should I choose CMU over USC for transfer this fall?",
        goals=["make a transfer decision"],
        time_pressure=TimePressure.MEDIUM,
        stress_level=6,
        workload=5,
        current_behavior="researching",
        decision_type="academic",
        reversibility=Reversibility.PARTIAL,
    )
    q = build_tavily_query_for_decision(
        us,
        "profile: I love salmon and weekend football and random old preferences",
    )
    ql = q.lower()
    assert "salmon" not in ql
    assert "weekend football" not in ql
    assert "cmu" in ql or "usc" in ql


def test_build_tavily_query_can_include_compact_profile_hint_when_enabled() -> None:
    us = UserState(
        raw_input="visa question?",
        goals=["avoid status risk"],
        time_pressure=TimePressure.HIGH,
        stress_level=7,
        workload=6,
        current_behavior="urgent",
        decision_type="career",
        reversibility=Reversibility.PARTIAL,
    )
    q = build_tavily_query_for_decision(
        us,
        "F-1 CPT USCIS random lifestyle notes",
        include_profile=True,
    )
    ql = q.lower()
    assert "f-1" in ql or "uscis" in ql
