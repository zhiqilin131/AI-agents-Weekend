"""F0 graph relevance cases — exercise REAL production ranking, $0, no API.

Non-tautological by design: each case's raw candidate pool includes decoy
nodes with a HIGHER score than the genuinely relevant nodes. The test passes
only if the real ``_rank_graph_nodes_for_display`` token-overlap tiering
(not raw score) pushes decoys below the relevant nodes — proving the
production relevance logic actually works, not just that our mock echoes
back what we fed it.
"""

from __future__ import annotations

import re

import pytest

from foresight_x.config import load_settings
from foresight_x.orchestration.pipeline import (
    _GRAPH_DISPLAY_STOPWORDS,
    _augment_memory_with_graph,
    _rank_graph_nodes_for_display,
)
from foresight_x.schemas import MemoryBundle, UserState

from tests.quality.loaders import load_graph_cases
from tests.quality.metrics import (
    bundle_from_nodes,
    memory_bundle_with_stale_pattern,
    noisy_candidate_pool_from_case,
    score_graph_case,
)


def _user_state_for_case(case) -> UserState:
    return UserState(
        raw_input=case.query,
        active_user_id="quality_graph",
        goals=case.goals,
        time_pressure="medium",
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type=case.decision_type,
        reversibility="partial",
    )


@pytest.fixture(scope="module")
def graph_cases():
    cases = load_graph_cases()
    assert len(cases) >= 8, "expected at least 8 graph cases"
    return cases


@pytest.mark.parametrize("case", load_graph_cases(), ids=lambda c: c.id)
def test_decoys_have_higher_raw_score_than_relevant_nodes(case) -> None:
    """Sanity check on the fixture itself: the test is only meaningful if decoys
    actually outrank relevant nodes on raw score (otherwise sorting-by-score
    alone would already pass, defeating the point)."""
    assert case.decoy_nodes, f"{case.id}: needs decoy_nodes to test real ranking, not just echo mocks"
    max_relevant = max(n.score for n in case.mock_top_nodes)
    min_decoy = min(n.score for n in case.decoy_nodes)
    assert min_decoy > max_relevant, (
        f"{case.id}: decoy score {min_decoy} must exceed relevant score {max_relevant} "
        "for this to be a real test of relevance tiering, not raw-score sorting"
    )


def _theme_tokens(text: str) -> set[str]:
    """Mirrors foresight_x.orchestration.pipeline._graph_theme_tokens's tokenizer,
    applied here to a case's query/goals/decision_type or a node label."""
    raw = {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text or "")}
    return {w for w in raw if w not in _GRAPH_DISPLAY_STOPWORDS}


@pytest.mark.parametrize("case", load_graph_cases(), ids=lambda c: c.id)
def test_fixture_token_overlap_invariants(case) -> None:
    """Direct, fast-failing guard for the exact bug this suite caught once
    already (g-08's 'family wedding' decoy accidentally sharing the
    decision_type token 'family' with the query): every mock_top_nodes label
    must overlap the query/goals/decision_type theme tokens (otherwise the
    production ranker won't treat it as relevant and the case is vacuous), and
    every decoy_nodes label must NOT overlap them (otherwise it isn't testing
    that irrelevant content gets suppressed — it's testing something else)."""
    query_tokens = _theme_tokens(" ".join([case.query, " ".join(case.goals), case.decision_type]))
    for n in case.mock_top_nodes:
        node_tokens = _theme_tokens(n.label)
        assert node_tokens & query_tokens, (
            f"{case.id}: mock_top_nodes label '{n.label}' shares no theme token with the "
            f"query ({sorted(query_tokens)}) — the production ranker will treat it as "
            "irrelevant (tier 2), making this case meaningless"
        )
    for n in case.decoy_nodes:
        node_tokens = _theme_tokens(n.label)
        overlap = node_tokens & query_tokens
        assert not overlap, (
            f"{case.id}: decoy_nodes label '{n.label}' accidentally overlaps theme token(s) "
            f"{sorted(overlap)} — it will be treated as relevant (tier <2) and won't test "
            "suppression of irrelevant high-score content at all"
        )


@pytest.mark.parametrize("case", load_graph_cases(), ids=lambda c: c.id)
def test_real_ranking_suppresses_high_score_decoys(case) -> None:
    """Feeds the REAL production ranker a noisy pool where irrelevant/blocklisted
    nodes have deliberately higher scores. Only token-overlap tiering can pass this."""
    us = _user_state_for_case(case)
    pool = noisy_candidate_pool_from_case(case)  # decoys first, higher score
    bundle = bundle_from_nodes(pool)

    ranked = _rank_graph_nodes_for_display(bundle, us)
    displayed = ranked[:4]  # matches _augment_memory_with_graph's display slice

    result = score_graph_case(case, displayed)
    assert result["pass"], {"case": case.id, "ranked_labels": [n.label for n in displayed], **result}


@pytest.mark.parametrize("case", load_graph_cases(), ids=lambda c: c.id)
def test_pipeline_augment_no_blocklist_leak(case) -> None:
    """End-to-end: noisy pool -> _augment_memory_with_graph -> displayed pattern line."""
    settings = load_settings().model_copy(update={"graph_enabled": True})
    us = _user_state_for_case(case)
    pool = noisy_candidate_pool_from_case(case)
    stale = "Graph influence: Old Stale Topic (0.77), Unrelated Pattern (0.55)"
    influence = bundle_from_nodes(pool)
    mem = memory_bundle_with_stale_pattern(stale_line=stale, graph=influence)
    out = _augment_memory_with_graph(mem, us, settings=settings, influence=influence)
    assert out.behavioral_patterns[0].startswith("Graph influence:")
    for banned in case.must_exclude:
        assert not any(banned.lower() in p.lower() for p in out.behavioral_patterns), (
            f"{case.id}: blocklisted term '{banned}' leaked into displayed pattern: "
            f"{out.behavioral_patterns[0]}"
        )
