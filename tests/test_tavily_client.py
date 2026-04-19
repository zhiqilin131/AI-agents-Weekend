"""TavilyGateway tests — mock `TavilyClient`, no network."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from foresight_x.retrieval.tavily_client import TAVILY_MAX_QUERY_CHARS, TavilyGateway


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
