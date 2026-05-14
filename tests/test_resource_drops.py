"""Resource drops: calendar internal action, Tavily query shaping, dedupe, filters."""

from __future__ import annotations

from unittest.mock import MagicMock

from foresight_x.config import Settings
from foresight_x.resources.resource_drops import INTERNAL_CALENDAR_ID, generate_resource_drops_for_recommendation
from foresight_x.resources.tavily_resources import (
    build_tavily_resource_queries,
    rank_resource_candidate,
    search_queries_as_ranked_facts,
    should_skip_external_resources,
)
from foresight_x.schemas import Fact, MemoryBundle, NextAction, Recommendation
from tests.test_report_surface import _make_trace, _minimal_user_state


def _trace(raw: str, decision_type: str = "career", next_actions: list[str] | None = None):
    us = _minimal_user_state(raw_input=raw, decision_type=decision_type)
    mem = MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary="")
    tr = _make_trace(mem=mem, us=us)
    if next_actions is not None:
        na = [NextAction(action=a, deadline=None) for a in next_actions]
        tr = tr.model_copy(
            update={
                "recommendation": Recommendation(
                    chosen_option_id=tr.recommendation.chosen_option_id,
                    reasoning=tr.recommendation.reasoning,
                    next_actions=na,
                    reassessment_triggers=tr.recommendation.reassessment_triggers,
                )
            }
        )
    return tr


def _no_tavily() -> Settings:
    return Settings(tavily_api_key="")


def test_generate_includes_calendar_when_next_actions_exist() -> None:
    tr = _trace("Help decide internship", next_actions=["Email recruiter"])
    drops = generate_resource_drops_for_recommendation(tr, settings=_no_tavily())
    assert any(d.id == INTERNAL_CALENDAR_ID for d in drops)


def test_no_calendar_when_no_next_actions() -> None:
    tr = _trace("x", next_actions=[])
    drops = generate_resource_drops_for_recommendation(tr, settings=_no_tavily())
    assert all(d.id != INTERNAL_CALENDAR_ID for d in drops)


def test_transfer_queries_official_flavor() -> None:
    tr = _trace("Should I transfer to USC next fall?", decision_type="academic")
    qs = build_tavily_resource_queries(tr)
    assert qs
    assert "transfer" in " ".join(qs).lower() or "common app" in " ".join(qs).lower()


def test_transferring_wording_still_triggers_transfer_queries() -> None:
    tr = _trace("I am transferring schools this year, what should I prepare?", decision_type="academic")
    qs = build_tavily_resource_queries(tr)
    joined = " ".join(qs).lower()
    assert "transfer" in joined or "common app" in joined


def test_emotional_skip_external() -> None:
    tr = _trace("I feel lonely and cry every night")
    assert should_skip_external_resources(tr) is True


def test_resource_request_not_skipped() -> None:
    tr = _trace("I feel sad — please send official resources and application links")
    assert should_skip_external_resources(tr) is False


def test_low_quality_domain_penalized() -> None:
    fact = Fact(
        text="Click here ultimate guide to everything\n spam",
        source_url="https://spam-seo.example/x",
        confidence=0.5,
    )
    r = rank_resource_candidate(fact=fact, query_used="official transfer", raw_user="transfer", sensitive_topic=False)
    assert r < 0.4


def test_no_external_urls_without_tavily() -> None:
    tr = _trace("Notion vs Obsidian for project notes")
    drops = generate_resource_drops_for_recommendation(tr, settings=_no_tavily())
    assert not any(d.source == "tavily" for d in drops)
    for d in drops:
        if d.url:
            assert d.source in ("tavily", "curated")


def test_duplicate_url_across_queries_skipped() -> None:
    gw = MagicMock()
    one = [
        Fact(text="Official\nbody", source_url="https://same.gov/page", confidence=0.9),
    ]
    gw.search_as_facts.return_value = one
    ranked = search_queries_as_ranked_facts(
        gw,
        ["q1", "q2"],
        raw_user="visa cpt",
        sensitive_topic=True,
        max_keep=4,
    )
    urls = [x[1].source_url for x in ranked]
    assert len(urls) == len(set(urls))
