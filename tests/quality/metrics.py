"""Scoring helpers for the quality benchmark (no LLM)."""

from __future__ import annotations

import re
from typing import Any

from foresight_x.schemas import DecisionTrace, GraphInfluenceBundle, InfluenceNode, MemoryBundle

from tests.quality.schema import GraphCase, MemoryPrecisionCase, QualityE2EScenario

# Baseline empirical ratios (tests/eval/reports/baseline.json, gpt-4o-mini full run).
_BASELINE_FULL_LLM_CALLS = 340
_BASELINE_FULL_COST_USD = 0.55
_CATEGORY_AVG_CALLS: dict[str, float] = {
    "decision": 27.5,
    "cross_session": 28.0,
    "shadow": 4.0,
}


def _norm(text: str) -> str:
    return (text or "").strip().lower()


def _tokens(text: str) -> set[str]:
    return {w.lower() for w in re.findall(r"[a-zA-Z\u4e00-\u9fff]+", text or "")}


def label_hits_group(label: str, group: list[str]) -> bool:
    lab = _norm(label)
    toks = _tokens(label)
    for term in group:
        t = _norm(term)
        if t in lab or t in toks:
            return True
    return False


def score_graph_case(case: GraphCase, top_nodes: list[InfluenceNode]) -> dict[str, Any]:
    labels = [n.label for n in top_nodes[:4]]
    exclude_hits = [ex for ex in case.must_exclude if any(ex.lower() in _norm(l) for l in labels)]
    exclude_pass = len(exclude_hits) == 0
    groups_hit = 0
    for group in case.must_include_any:
        if any(label_hits_group(lab, group) for lab in labels):
            groups_hit += 1
    min_hit = max(1, case.min_include_groups_hit)
    include_pass = groups_hit >= min_hit
    include_rate = groups_hit / max(1, len(case.must_include_any)) if case.must_include_any else 1.0
    score = (0.0 if not exclude_pass else 1.0) * (0.4 + 0.6 * min(1.0, groups_hit / min_hit))
    return {
        "labels": labels,
        "exclude_pass": exclude_pass,
        "exclude_hits": exclude_hits,
        "include_groups_hit": groups_hit,
        "include_pass": include_pass,
        "include_rate": round(include_rate, 4),
        "graph_score": round(score, 4),
        "pass": exclude_pass and include_pass,
    }


def graph_nodes_from_case(case: GraphCase) -> list[InfluenceNode]:
    return [
        InfluenceNode(
            node_id=n.node_id,
            label=n.label,
            node_type=n.node_type,
            layer="concept",
            score=n.score,
            why=n.why,
        )
        for n in case.mock_top_nodes
    ]


def noisy_candidate_pool_from_case(case: GraphCase) -> list[InfluenceNode]:
    """Relevant nodes + high-score decoys, deliberately unsorted (decoys first).

    This simulates what an imperfect retrieval backend might actually hand back
    before the production display-ranking logic runs — decoys carry a HIGHER
    raw score than the genuinely relevant nodes, so a test against this pool is
    only meaningful if real token-overlap tiering (not raw score) suppresses them.
    """
    decoys = [
        InfluenceNode(
            node_id=f"graphiti:decoy:{i}",
            label=n.label,
            node_type=n.node_type,
            layer="concept",
            score=n.score,
            why=n.why,
        )
        for i, n in enumerate(case.decoy_nodes)
    ]
    return decoys + graph_nodes_from_case(case)


def score_memory_precision(case: MemoryPrecisionCase) -> dict[str, Any]:
    blob = " ".join(case.top_memory_summaries).lower()
    bad = [w for w in case.must_not_contain if w.lower() in blob]
    good_hit = any(g.lower() in blob for g in case.must_contain_any) if case.must_contain_any else True
    precision_pass = not bad and good_hit
    return {
        "must_not_hits": bad,
        "must_contain_any_hit": good_hit,
        "pass": precision_pass,
        "memory_precision_score": 1.0 if precision_pass else 0.0,
    }


def _memory_blob_from_trace(trace: DecisionTrace) -> str:
    parts: list[str] = []
    mem = trace.memory
    for row in mem.similar_past_decisions[:3]:
        parts.append(row.situation_summary or "")
    for pat in mem.behavioral_patterns[:3]:
        parts.append(pat)
    gi = mem.graph_influence
    if gi and gi.top_nodes:
        parts.extend(n.label for n in gi.top_nodes[:4])
    return " ".join(parts).lower()


def score_e2e_extras(scenario: QualityE2EScenario, trace: DecisionTrace) -> dict[str, Any]:
    exp = scenario.expected
    blob = _memory_blob_from_trace(trace)
    mem_bad = [w for w in exp.must_exclude_in_top_memory if w.lower() in blob]
    graph_labels = [n.label for n in (trace.memory.graph_influence.top_nodes or [])[:4]] if trace.memory.graph_influence else []
    graph_bad = [w for w in exp.must_exclude_graph_labels if any(w.lower() in _norm(l) for l in graph_labels)]

    rounds = 0
    coverage: float | None = None
    if trace.scoring_elicitation_rounds:
        rounds = len(trace.scoring_elicitation_rounds)
    if isinstance(trace.feature_audit, dict):
        coverage = float(trace.feature_audit.get("grounded_feature_coverage") or 0.0)

    rounds_ok = rounds <= exp.max_elicitation_rounds
    coverage_ok = True
    if exp.min_coverage_after_gate is not None and coverage is not None:
        coverage_ok = coverage >= exp.min_coverage_after_gate

    memory_precision = 1.0 if not mem_bad else 0.0
    graph_blocklist = 1.0 if not graph_bad else 0.0

    return {
        "memory_exclude_hits": mem_bad,
        "graph_exclude_hits": graph_bad,
        "elicitation_rounds": rounds,
        "coverage_ratio": coverage,
        "memory_precision_score": memory_precision,
        "graph_blocklist_score": graph_blocklist,
        "rounds_ok": rounds_ok,
        "coverage_ok": coverage_ok,
        "pass": not mem_bad and not graph_bad and rounds_ok and coverage_ok,
    }


def estimate_llm_calls(scenarios: list[QualityE2EScenario]) -> int:
    total = 0
    for s in scenarios:
        if s.metadata.estimated_llm_calls is not None:
            total += int(s.metadata.estimated_llm_calls)
        else:
            total += int(_CATEGORY_AVG_CALLS.get(s.category, 27.5))
    return total


def estimate_cost_usd(llm_calls: int, *, margin: float = 0.30) -> float:
    base = _BASELINE_FULL_COST_USD * (llm_calls / _BASELINE_FULL_LLM_CALLS)
    return round(base * (1.0 + margin), 3)


# estimate_cost_usd() above treats every LLM call as costing the same, i.e. it
# proxies $ with a raw call COUNT rather than token volume. That's a fine
# approximation only if the scenario mix matches the baseline's mix; it breaks
# down for e.g. cross_session scenarios, whose calls each carry substantially
# more prompt context (accumulated multi-turn history) than a single-turn
# shadow call. These multipliers are a documented heuristic (not measured
# tokens — the LLM gateway does not currently expose token usage, see
# tests/eval/runner/llm_counter.py), override via env once real per-category
# cost data exists in tests/quality/dgs_history.jsonl-adjacent run logs.
_CATEGORY_TOKEN_SCALE: dict[str, float] = {
    "decision": 1.0,
    "cross_session": 1.3,
    "shadow": 0.6,
}


def _category_token_scale(category: str) -> float:
    import os

    env_key = f"QUALITY_TOKEN_SCALE_{category.upper()}"
    val = os.getenv(env_key)
    if val is not None:
        try:
            return float(val)
        except ValueError:
            pass
    return _CATEGORY_TOKEN_SCALE.get(category, 1.0)


def estimate_cost_usd_weighted(
    scenarios: list[QualityE2EScenario],
    *,
    margin: float = 0.30,
    repeat: int = 1,
) -> dict[str, Any]:
    """Cost estimate that scales each scenario's call count by a per-category
    token-scale multiplier before applying the baseline $/call ratio, instead
    of assuming every call is equally expensive. Returns a breakdown (not just
    a single number) so the raw call count and the token-adjusted estimate can
    both be inspected — the gap between them is exactly the correction this
    adds over the naive estimate_cost_usd(estimate_llm_calls(...)) path.
    """
    raw_calls = 0
    weighted_calls = 0.0
    n_repeat = max(1, int(repeat))
    for s in scenarios:
        calls = int(s.metadata.estimated_llm_calls or _CATEGORY_AVG_CALLS.get(s.category, 27.5))
        raw_calls += calls
        weighted_calls += calls * _category_token_scale(s.category)
    raw_calls *= n_repeat
    weighted_calls *= n_repeat

    raw_cost = estimate_cost_usd(raw_calls, margin=margin)
    weighted_cost = round(
        _BASELINE_FULL_COST_USD * (weighted_calls / _BASELINE_FULL_LLM_CALLS) * (1.0 + margin), 3
    )
    return {
        "raw_llm_calls": raw_calls,
        "token_weighted_llm_calls": round(weighted_calls, 1),
        "raw_cost_usd": raw_cost,
        "token_weighted_cost_usd": weighted_cost,
    }


# Default DGS component weights. These were set by judgment, not calibrated
# against a labeled dataset of known-good/known-bad runs (none existed at
# design time). tests/quality/dgs_history.jsonl now accumulates real run data
# over time — once enough of it exists, re-derive these from that history
# rather than tuning by feel. Each is overridable independently via env var
# for calibration experiments without a code change; weights are re-normalized
# to sum to 1.0 so a partial override can't silently change the total scale.
_DGS_WEIGHT_DEFAULTS = {
    "memory": 0.30,
    "graph": 0.25,
    "mcda": 0.20,
    "report": 0.15,
    "recommendation": 0.10,
}
_DGS_WEIGHT_ENV_KEYS = {
    "memory": "QUALITY_DGS_WEIGHT_MEMORY",
    "graph": "QUALITY_DGS_WEIGHT_GRAPH",
    "mcda": "QUALITY_DGS_WEIGHT_MCDA",
    "report": "QUALITY_DGS_WEIGHT_REPORT",
    "recommendation": "QUALITY_DGS_WEIGHT_RECOMMENDATION",
}


def dgs_weights() -> dict[str, float]:
    import os

    raw = {}
    for key, env_key in _DGS_WEIGHT_ENV_KEYS.items():
        val = os.getenv(env_key)
        raw[key] = float(val) if val is not None else _DGS_WEIGHT_DEFAULTS[key]
    total = sum(raw.values()) or 1.0
    return {k: v / total for k, v in raw.items()}


def compute_dgs(
    *,
    memory_score: float,
    graph_score: float,
    mcda_score: float,
    report_score: float,
    recommendation_score: float,
) -> float:
    w = dgs_weights()
    return round(
        w["memory"] * memory_score
        + w["graph"] * graph_score
        + w["mcda"] * mcda_score
        + w["report"] * report_score
        + w["recommendation"] * recommendation_score,
        4,
    )


def bundle_from_nodes(nodes: list[InfluenceNode]) -> GraphInfluenceBundle:
    return GraphInfluenceBundle(
        algorithm="graphiti_hybrid_rrf_v1",
        top_nodes=nodes,
        seed_nodes=[],
        surfaced_decision_ids=[],
        notes=["quality benchmark mock"],
    )


def memory_bundle_with_stale_pattern(
    *,
    stale_line: str,
    graph: GraphInfluenceBundle | None,
) -> MemoryBundle:
    return MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=[stale_line, "Retrieval themes: career"],
        prior_outcomes_summary="",
        graph_influence=graph,
    )
