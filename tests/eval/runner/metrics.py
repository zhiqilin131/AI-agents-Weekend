from __future__ import annotations

from typing import Any

from tests.eval.runner.replay import TurnResult
from tests.eval.schema import Scenario


def _last_trace(results: list[TurnResult]) -> Any | None:
    for item in reversed(results):
        if item.decision_trace is not None:
            return item.decision_trace
    return None


def score_retrieval(scenario: Scenario, results: list[TurnResult]) -> dict[str, Any]:
    trace = _last_trace(results)
    expected_ids = list(scenario.expected.must_retrieve_memory_ids)
    if not expected_ids:
        return {"skipped": "no_expected_memory"}
    if trace is None or getattr(trace, "memory", None) is None:
        return {"skipped": "no_memory_bundle"}

    retrieved_ids: list[str] = []
    for row in getattr(trace.memory, "similar_past_decisions", []) or []:
        rid = getattr(row, "id", None) or getattr(row, "decision_id", None)
        if rid:
            retrieved_ids.append(str(rid))

    matched = [x for x in expected_ids if x in set(retrieved_ids)]
    missing = [x for x in expected_ids if x not in set(retrieved_ids)]
    recall = (len(matched) / len(expected_ids)) if expected_ids else 1.0
    return {
        "recall": float(recall),
        "missing_ids": missing,
        "retrieved_ids": retrieved_ids,
    }


def score_coverage(scenario: Scenario, results: list[TurnResult]) -> dict[str, Any]:
    trace = _last_trace(results)
    if trace is None or not getattr(trace, "options", None):
        return {"skipped": "no_options"}

    expected_keywords = [k.strip().lower() for k in scenario.expected.must_include_in_options if k.strip()]
    if not expected_keywords:
        return {"matched_keywords": [], "missing_keywords": []}

    option_names = [str(getattr(o, "name", "")).lower() for o in trace.options]
    matched: list[str] = []
    for keyword_group in expected_keywords:
        alts = [x.strip() for x in keyword_group.split("|") if x.strip()]
        if not alts:
            continue
        if any(any(alt in name for alt in alts) for name in option_names):
            matched.append(keyword_group)
    missing = [k for k in expected_keywords if k not in matched]
    return {
        "matched_keywords": matched,
        "missing_keywords": missing,
    }


def score_recommendation(scenario: Scenario, results: list[TurnResult]) -> dict[str, Any]:
    trace = _last_trace(results)
    expected_present = bool(scenario.expected.recommendation_present)

    recommendation = getattr(trace, "recommendation", None) if trace is not None else None
    chosen_option_id = str(getattr(recommendation, "chosen_option_id", "") or "").strip()
    reasoning = str(getattr(recommendation, "reasoning", "") or "").strip()
    next_actions = list(getattr(recommendation, "next_actions", []) or [])

    present = bool(chosen_option_id or reasoning or next_actions)

    if not expected_present:
        return {
            "present": present,
            "fields_complete": not present,
        }

    fields_complete = bool(chosen_option_id and reasoning and len(next_actions) > 0)
    return {
        "present": present,
        "fields_complete": fields_complete,
    }


def score_latency(scenario: Scenario, results: list[TurnResult]) -> dict[str, Any]:
    budget_ms = int(scenario.expected.latency_p95_ms)
    target_ms = (
        int(scenario.expected.latency_target_ms)
        if scenario.expected.latency_target_ms is not None
        else budget_ms
    )
    if not results:
        return {
            "total_ms": 0,
            "by_stage": {},
            "budget_ms": budget_ms,
            "target_ms": target_ms,
            "vs_target_gap_ms": 0 - target_ms,
            "within_budget": True,
            "within_target": 0 <= target_ms,
        }

    peak = max(results, key=lambda r: int(r.total_latency_ms or 0))
    total_ms = int(peak.total_latency_ms or 0)
    by_stage = dict(peak.stage_latency_ms or {})
    vs_target_gap_ms = total_ms - target_ms

    return {
        "total_ms": total_ms,
        "by_stage": by_stage,
        "budget_ms": budget_ms,
        "target_ms": target_ms,
        "vs_target_gap_ms": vs_target_gap_ms,
        "within_budget": total_ms <= budget_ms,
        "within_target": total_ms <= target_ms,
    }
