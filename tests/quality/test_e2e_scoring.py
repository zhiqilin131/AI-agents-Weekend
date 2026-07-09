"""Offline scoring-engine regression tests — $0, no API, always run.

Uses hand-built DecisionTrace fixtures (tests/quality/fixtures.py) committed to
the repo, NOT the gitignored ``reports/traces/`` output of a prior paid run.
This guarantees the scoring engine itself is exercised on every checkout / CI
run, instead of silently skipping when nobody has run a paid E2E suite yet.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from unittest.mock import patch

from tests.quality.e2e_scoring import (
    aggregate_repeated_scenario_runs,
    evaluate_safety,
    score_infrastructure,
    score_memory_retrieval,
    score_personalization,
    score_recommendation_graded,
    score_scenario,
    score_shadow_response_quality,
)
from tests.quality.fixtures import good_career_trace, graph_leak_trace, missing_recommendation_trace
from tests.quality.loaders import load_e2e_scenarios, quality_root
from tests.quality.policy import DEFAULT_POLICY, evaluate_run_gate
from tests.quality.replay import TurnResult
from tests.quality.score_report import score_trace_file
from foresight_x.schemas import DecisionTrace

_CACHED_TRACES = quality_root() / "reports/traces/d2ff0dc4-31bf-4cda-936a-c319046ba8be"


def _scenario(scenario_id: str):
    for s in load_e2e_scenarios():
        if s.id == scenario_id:
            return s
    raise KeyError(scenario_id)


def _turn(trace: DecisionTrace) -> TurnResult:
    return TurnResult(
        turn_index=0,
        user_input=trace.original_user_input,
        system_output=trace.recommendation.reasoning or "no recommendation yet",
        decision_trace=trace,
        stage_latency_ms={},
        total_latency_ms=1000,
        llm_calls={},
        error=None,
    )


def test_good_career_trace_scores_high_and_passes() -> None:
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    trace = good_career_trace()
    row = score_scenario(scenario, [_turn(trace)], llm_total=10, errors=[], degraded_stages=None)
    assert row["status"] == "pass"
    assert row["metrics"]["components"]["memory"] >= 0.9
    assert row["metrics"]["components"]["graph"] == 1.0
    assert row["metrics"]["components"]["recommendation"] >= 0.9
    assert float(row["metrics"]["dgs"]) >= 0.8


def test_graph_leak_trace_tanks_graph_component_only() -> None:
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    good = score_scenario(scenario, [_turn(good_career_trace())], llm_total=10, errors=[], degraded_stages=None)
    leaked = score_scenario(scenario, [_turn(graph_leak_trace())], llm_total=10, errors=[], degraded_stages=None)

    assert leaked["metrics"]["components"]["graph"] == 0.0
    assert leaked["metrics"]["graph"]["exclude_hits"], "expected the leaked 'salmon' label to be flagged"
    # Recommendation is untouched by the graph leak (independent component).
    assert leaked["metrics"]["components"]["recommendation"] == good["metrics"]["components"]["recommendation"]
    # The leaked label also surfaces in the combined memory blocklist check
    # (must_exclude_in_top_memory), which is intentional defense-in-depth, so
    # memory_precision — and thus the memory component — drops too.
    assert leaked["metrics"]["components"]["memory"] < good["metrics"]["components"]["memory"]
    assert float(leaked["metrics"]["dgs"]) < float(good["metrics"]["dgs"])


def test_missing_recommendation_trace_scores_low_on_recommendation() -> None:
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    trace = missing_recommendation_trace()
    rec = score_recommendation_graded(scenario, trace)
    assert rec["present"] is False
    assert float(rec["score"]) == 0.0

    good = score_scenario(scenario, [_turn(good_career_trace())], llm_total=10, errors=[], degraded_stages=None)
    row = score_scenario(scenario, [_turn(trace)], llm_total=10, errors=[], degraded_stages=None)
    assert row["metrics"]["components"]["recommendation"] == 0.0
    assert float(row["metrics"]["dgs"]) < float(good["metrics"]["dgs"])


def test_memory_retrieval_soft_match_fallback_uses_real_content_not_id() -> None:
    """The soft-match fallback must key off the persona's ACTUAL past-decision text,
    not the opaque internal id (which never appears verbatim in prose)."""
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    trace = good_career_trace()
    # Drop the exact-id match to force the fallback path, but keep memory content
    # (situation_summary) that overlaps with pd_jordan_002's real text.
    trace = trace.model_copy(
        update={
            "memory": trace.memory.model_copy(
                update={
                    "similar_past_decisions": [],
                    "behavioral_patterns": [
                        "Retrieval themes: career",
                        "Employer countered a competing offer with retention bonus tied to two-year stay.",
                    ],
                }
            )
        }
    )
    mem = score_memory_retrieval(scenario, trace)
    assert mem["matched_ids"] == []
    assert "pd_jordan_002" in mem["soft_matched_ids"]
    assert mem["missing_ids"] == []
    assert float(mem["score"]) >= float(scenario.expected.min_retrieval_recall)


def test_memory_retrieval_no_fallback_when_content_absent() -> None:
    """A bare internal id string in the blob must NOT count as a match (the bug
    this fallback replaced): with no real content overlap, recall stays low."""
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    trace = good_career_trace()
    trace = trace.model_copy(
        update={
            "memory": trace.memory.model_copy(
                update={
                    "similar_past_decisions": [],
                    # Contains the raw id string but none of the real decision content.
                    "behavioral_patterns": ["Retrieval themes: pd_jordan_002 unrelated chatter"],
                }
            )
        }
    )
    mem = score_memory_retrieval(scenario, trace)
    assert mem["soft_matched_ids"] == []
    assert "pd_jordan_002" in mem["missing_ids"]


def test_policy_gate_logic() -> None:
    rows = [
        {"scenario_id": "a", "status": "pass", "hard_gate_failures": [], "metrics": {"dgs": 0.8}},
        {"scenario_id": "b", "status": "pass", "hard_gate_failures": [], "metrics": {"dgs": 0.75}},
    ]
    gate = evaluate_run_gate(rows, policy=DEFAULT_POLICY)
    assert gate.gate_pass is True
    assert gate.mean_dgs >= 0.72


def test_scenario_score_handles_shadow_no_recommendation() -> None:
    scenario = _scenario("fict-sh-01-anxiety-checkin")
    results = [
        TurnResult(
            turn_index=0,
            user_input="venting",
            system_output="That sounds really hard. Consider resting tonight.",
            decision_trace=None,
            stage_latency_ms={},
            total_latency_ms=1000,
            llm_calls={},
            error=None,
        )
    ]
    row = score_scenario(scenario, results, llm_total=2, errors=[], degraded_stages=None)
    assert row["status"] == "pass"
    assert float(row["metrics"]["dgs"]) > 0.5


def test_shadow_scenario_with_empty_response_scores_poorly() -> None:
    """A shadow turn that produces NOTHING must not score identically to a good
    response — this is the gap the vacuous options/recommendation blend used to
    hide (recommendation_present: false + no options -> always 1.0)."""
    scenario = _scenario("fict-sh-01-anxiety-checkin")
    empty_results = [
        TurnResult(
            turn_index=0,
            user_input="venting",
            system_output="",
            decision_trace=None,
            stage_latency_ms={},
            total_latency_ms=1000,
            llm_calls={},
            error=None,
        )
    ]
    good_results = [
        TurnResult(
            turn_index=0,
            user_input="venting",
            system_output="That sounds really hard. Consider resting tonight and revisiting this tomorrow.",
            decision_trace=None,
            stage_latency_ms={},
            total_latency_ms=1000,
            llm_calls={},
            error=None,
        )
    ]
    empty_row = score_scenario(scenario, empty_results, llm_total=2, errors=[], degraded_stages=None)
    good_row = score_scenario(scenario, good_results, llm_total=2, errors=[], degraded_stages=None)

    assert empty_row["metrics"]["shadow_quality"]["score"] == 0.0
    assert good_row["metrics"]["shadow_quality"]["score"] == 1.0
    assert empty_row["metrics"]["components"]["report"] == 0.0
    assert float(empty_row["metrics"]["dgs"]) < float(good_row["metrics"]["dgs"])


def test_personalization_detects_generic_boilerplate_vs_grounded_reasoning() -> None:
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    grounded = score_personalization(scenario, good_career_trace())
    assert grounded["grounded_in_persona"] is True
    assert float(grounded["score"]) == 1.0

    generic = good_career_trace().model_copy(
        update={
            "recommendation": good_career_trace().recommendation.model_copy(
                update={"reasoning": "Pick whichever option you feel like today."}
            ),
            "options": [
                o.model_copy(update={"description": "Option A.", "key_assumptions": []})
                for o in good_career_trace().options
            ],
        }
    )
    result = score_personalization(scenario, generic)
    assert result["grounded_in_persona"] is False
    assert float(result["score"]) == 0.5


def test_latency_target_nudges_score_without_hard_failing() -> None:
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    assert scenario.expected.latency_target_ms is not None
    target = int(scenario.expected.latency_target_ms)
    budget = int(scenario.expected.latency_p95_ms)

    on_target = TurnResult(
        turn_index=0,
        user_input="x",
        system_output="y",
        decision_trace=None,
        stage_latency_ms={},
        total_latency_ms=max(0, target - 100),
        llm_calls={},
        error=None,
    )
    within_budget_missed_target = TurnResult(
        turn_index=0,
        user_input="x",
        system_output="y",
        decision_trace=None,
        stage_latency_ms={},
        total_latency_ms=min(budget, target + int((budget - target) / 2) or target + 1),
        llm_calls={},
        error=None,
    )
    fast = score_infrastructure(scenario, [on_target], llm_total=5, llm_budget=50)
    slow_but_ok = score_infrastructure(scenario, [within_budget_missed_target], llm_total=5, llm_budget=50)

    assert fast["meets_latency_target"] is True
    assert fast["latency_score"] == 1.0
    assert slow_but_ok["meets_latency_target"] is False
    assert slow_but_ok["latency_score"] < fast["latency_score"]


def test_llm_judge_disabled_by_default_never_calls_out() -> None:
    """use_llm_judge defaults to False — must never attempt an LLM call unless
    explicitly opted in, keeping the default path $0 as designed."""
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    turn = _turn(good_career_trace())
    with patch("tests.quality.llm_judge.judge_safety_semantic") as mock_judge:
        result = evaluate_safety(scenario, [turn])
    mock_judge.assert_not_called()
    assert result["llm_judge_used"] is False
    assert result["pass"] is True


def test_llm_judge_can_flip_a_keyword_pass_to_a_fail() -> None:
    """A paraphrased violation that dodges regex trigger words should still be
    caught when the LLM judge is opted in — this is the entire point of the
    feature (defense against keyword-evasion)."""
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    assert "not_therapy" in scenario.expected.must_not_violate
    turn = _turn(good_career_trace())  # benign output; regex check alone would pass

    with patch(
        "tests.quality.llm_judge.judge_safety_semantic",
        return_value={
            "available": True,
            "verdicts": {"not_therapy": {"violated": True, "rationale": "subtle diagnosis"}},
            "error": None,
        },
    ):
        result = evaluate_safety(scenario, [turn], use_llm_judge=True)

    assert result["pass"] is False
    assert result["violations"]["not_therapy"] == "fail"
    assert result["llm_judge_used"] is True


def test_llm_judge_never_downgrades_an_existing_keyword_violation() -> None:
    """OR semantics: the judge can only ADD violations, never remove one the
    keyword/regex layer already found — a judge that (wrongly) says 'fine' must
    not undo a real regex-caught violation."""
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    bad_trace = good_career_trace().model_copy(
        update={
            "recommendation": good_career_trace().recommendation.model_copy(
                update={"reasoning": "You likely have depression; here is your treatment plan."}
            )
        }
    )
    turn = _turn(bad_trace)

    baseline = evaluate_safety(scenario, [turn], use_llm_judge=False)
    assert baseline["pass"] is False  # regex/keyword layer alone already catches this

    with patch(
        "tests.quality.llm_judge.judge_safety_semantic",
        return_value={"available": True, "verdicts": {"not_therapy": {"violated": False, "rationale": ""}}, "error": None},
    ):
        with_judge = evaluate_safety(scenario, [turn], use_llm_judge=True)
    assert with_judge["pass"] is False


def test_severe_latency_overrun_is_a_hard_gate_failure() -> None:
    """score_infrastructure's result used to be computed but never fed into
    compute_dgs() or hard_gate_failures — a scenario could blow its latency
    budget by any amount and still score a perfect DGS and 'pass'. Only SEVERE
    (2x budget) overruns should hard-fail; ordinary overruns stay soft."""
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    budget_ms = int(scenario.expected.latency_p95_ms)
    trace = good_career_trace()

    mild_overrun = dataclasses.replace(_turn(trace), total_latency_ms=int(budget_ms * 1.3))
    severe_overrun = dataclasses.replace(_turn(trace), total_latency_ms=int(budget_ms * 2.5))

    mild_row = score_scenario(scenario, [mild_overrun], llm_total=10, errors=[], degraded_stages=None)
    severe_row = score_scenario(scenario, [severe_overrun], llm_total=10, errors=[], degraded_stages=None)

    assert "infra_severe_latency_overrun" not in mild_row["hard_gate_failures"]
    assert mild_row["status"] == "pass"
    assert "infra_severe_latency_overrun" in severe_row["hard_gate_failures"]
    assert severe_row["status"] == "fail"


def test_severe_llm_call_overrun_is_a_hard_gate_failure() -> None:
    scenario = _scenario("fict-career-01-counter-offer-deadline")
    budget = int(scenario.metadata.llm_call_count_budget)
    trace = good_career_trace()

    normal_row = score_scenario(scenario, [_turn(trace)], llm_total=budget, errors=[], degraded_stages=None)
    runaway_row = score_scenario(
        scenario, [_turn(trace)], llm_total=budget * 3, errors=[], degraded_stages=None
    )

    assert "infra_severe_llm_overrun" not in normal_row["hard_gate_failures"]
    assert "infra_severe_llm_overrun" in runaway_row["hard_gate_failures"]
    assert runaway_row["status"] == "fail"


def _row(status: str, dgs: float, hard_gate_failures: list[str] | None = None) -> dict:
    return {
        "scenario_id": "fixture",
        "status": status,
        "hard_gate_failures": hard_gate_failures or [],
        "errors": [],
        "known_backend_issue": None,
        "metrics": {"dgs": dgs, "components": {}},
    }


def test_aggregate_single_run_is_a_passthrough_with_repeat_bookkeeping() -> None:
    row = _row("pass", 0.81)
    merged = aggregate_repeated_scenario_runs([row])
    assert merged["metrics"]["dgs"] == 0.81
    assert merged["metrics"]["repeat_count"] == 1
    assert merged["metrics"]["dgs_spread"] == 0.0
    assert merged["repeats"] == [row]


def test_aggregate_repeated_runs_uses_median_dgs_and_majority_status() -> None:
    """A single unlucky/lucky LLM sample must not decide pass/fail alone — the
    merged row should reflect the median score and the majority vote."""
    rows = [_row("pass", 0.90), _row("pass", 0.85), _row("fail", 0.40, ["some_gate"])]
    merged = aggregate_repeated_scenario_runs(rows)
    assert merged["metrics"]["dgs"] == 0.85  # median of [0.40, 0.85, 0.90]
    assert merged["status"] == "pass"  # 2 of 3 passed
    assert merged["metrics"]["repeat_count"] == 3
    assert merged["metrics"]["dgs_spread"] == pytest.approx(0.50)
    assert merged["metrics"]["high_variance"] is True
    # The one hard-gate failure that DID occur must stay visible, not get
    # averaged away just because it lost the majority vote.
    assert "some_gate" in merged["hard_gate_failures"]


def test_aggregate_repeated_runs_ties_break_toward_more_severe_status() -> None:
    rows = [_row("pass", 0.90), _row("fail", 0.40, ["gate_x"])]
    merged = aggregate_repeated_scenario_runs(rows)
    assert merged["status"] == "fail"  # 1-1 tie must not silently resolve to "pass"


def test_aggregate_repeated_runs_low_variance_is_not_flagged() -> None:
    rows = [_row("pass", 0.80), _row("pass", 0.82), _row("pass", 0.81)]
    merged = aggregate_repeated_scenario_runs(rows)
    assert merged["metrics"]["high_variance"] is False


def test_known_backend_issue_quarantines_scenario_out_of_gate() -> None:
    rows = [
        {
            "scenario_id": "healthy",
            "status": "pass",
            "hard_gate_failures": [],
            "known_backend_issue": None,
            "metrics": {"dgs": 0.85},
        },
        {
            "scenario_id": "known_broken",
            "status": "fail",
            "hard_gate_failures": ["graph_influence_absent"],
            "known_backend_issue": "TICKET-123: graph backend flaky in CI, tracked separately",
            "metrics": {"dgs": 0.10},
        },
    ]
    gate = evaluate_run_gate(rows, policy=DEFAULT_POLICY)
    assert gate.gate_pass is True, "the quarantined scenario's failure must not block the gate"
    assert gate.scenario_total == 1
    assert len(gate.quarantined) == 1
    assert gate.quarantined[0]["scenario_id"] == "known_broken"
    assert gate.quarantined[0]["dgs"] == 0.10


# --- Optional smoke tests against a REAL prior paid run, when available -------
# These add extra confidence on real model output but are never load-bearing:
# the tests above already give unconditional, deterministic coverage of the
# scoring engine itself.


@pytest.mark.skipif(not _CACHED_TRACES.exists(), reason="optional smoke: no cached traces from a prior paid run")
@pytest.mark.parametrize(
    "trace_name,scenario_id",
    [
        ("fict-career-01-counter-offer-deadline", "fict-career-01-counter-offer-deadline"),
        ("fict-money-01-parents-loan", "fict-money-01-parents-loan"),
        ("fict-family-01-wedding-attendance", "fict-family-01-wedding-attendance"),
    ],
)
def test_cached_trace_scores_without_errors_smoke(trace_name: str, scenario_id: str) -> None:
    scenario = _scenario(scenario_id)
    trace_path = _CACHED_TRACES / f"{trace_name}.json"
    if not trace_path.exists():
        pytest.skip(f"missing {trace_path}")
    row = score_trace_file(scenario, trace_path)
    assert row["status"] != "error"
    assert float(row["metrics"]["dgs"]) > 0.4
