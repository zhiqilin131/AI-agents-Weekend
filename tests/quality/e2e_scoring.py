"""Graded industrial scoring for paid quality E2E scenarios."""

from __future__ import annotations

import statistics
from typing import Any

from foresight_x.schemas import DecisionTrace

from tests.eval.runner.metrics import score_latency
from tests.eval.runner.safety_check import check_safety_rules, evaluate_must_not_violate
from tests.quality.loaders import load_persona
from tests.quality.metrics import _memory_blob_from_trace, _tokens, compute_dgs, score_e2e_extras
from tests.quality.replay import TurnResult
from tests.quality.schema import QualityE2EScenario

_SOFT_MATCH_MIN_TOKENS = 2
_SOFT_MATCH_MIN_RATIO = 0.4


def _persona_past_decision_text(persona_id: str, mem_id: str) -> str:
    """Real content (not the internal id) of a persona's past decision, for soft-match fallback."""
    try:
        persona = load_persona(persona_id)
    except Exception:
        return ""
    for row in persona.past_decisions:
        rid = str(row.get("id") or row.get("decision_id") or "").strip()
        if rid == mem_id:
            parts = [str(row.get("situation_summary", "")), str(row.get("chosen_option", ""))]
            return " ".join(p for p in parts if p)
    return ""


def _last_trace(results: list[TurnResult]) -> DecisionTrace | None:
    for item in reversed(results):
        if item.decision_trace is not None:
            return item.decision_trace
    return None


_PERSONALIZATION_MIN_TOKEN_LEN = 5


def _persona_signature_tokens(persona_id: str) -> set[str]:
    """Distinguishing vocabulary for a persona (values/constraints/priorities), used
    to check whether a recommendation was actually grounded in THIS user's specifics
    rather than generic boilerplate that would fit any persona in the same category."""
    try:
        persona = load_persona(persona_id)
    except Exception:
        return set()
    parts: list[str] = []
    parts.extend(persona.values)
    parts.extend(persona.known_constraints)
    parts.extend(persona.constraints)
    parts.extend(persona.priorities)
    parts.extend(persona.user_priorities)
    text = " ".join(str(p) for p in parts)
    return {t for t in _tokens(text) if len(t) >= _PERSONALIZATION_MIN_TOKEN_LEN}


def score_personalization(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    """Informational-but-scored check: does the recommendation reference anything
    specific to this persona's known values/constraints/priorities, or could the
    same text have been generated for any persona in this category? Skips (no
    signal) when the persona has no distinguishing vocabulary to check against,
    rather than penalizing scenarios that can't meaningfully test this."""
    if trace is None:
        return {"score": None, "skipped": True}
    sig_tokens = _persona_signature_tokens(scenario.persona_id)
    if not sig_tokens:
        return {"score": None, "skipped": True}

    text_parts = [trace.recommendation.reasoning or ""]
    text_parts.extend(o.description for o in trace.options)
    text_parts.extend(o.name for o in trace.options)
    for o in trace.options:
        text_parts.extend(o.key_assumptions or [])
    blob_tokens = _tokens(" ".join(text_parts))

    overlap = sig_tokens & blob_tokens
    grounded = bool(overlap)
    return {
        "score": 1.0 if grounded else 0.5,
        "grounded_in_persona": grounded,
        "overlap_tokens": sorted(overlap),
        "signature_token_count": len(sig_tokens),
    }


_SHADOW_REFUSAL_MARKERS = (
    "i cannot help",
    "i can't help",
    "as an ai",
    "i'm just an ai",
    "i am unable to assist",
)
_SHADOW_MIN_RESPONSE_LEN = 20


def score_shadow_response_quality(results: list[TurnResult]) -> dict[str, Any]:
    """Shadow scenarios have no options/recommendation, so the generic report_score
    blend (options+recommendation) always evaluates to a vacuous 1.0 — a pipeline
    that produces an EMPTY response for a shadow turn would score identically to
    one that responds well. This checks the actual response text instead."""
    text = ""
    for turn in reversed(results):
        if (turn.system_output or "").strip():
            text = turn.system_output.strip()
            break
    length_ok = len(text) >= _SHADOW_MIN_RESPONSE_LEN
    not_refusal = not any(marker in text.lower() for marker in _SHADOW_REFUSAL_MARKERS)
    if not text:
        score = 0.0
    elif length_ok and not_refusal:
        score = 1.0
    else:
        score = 0.4
    return {
        "score": score,
        "response_length": len(text),
        "length_ok": length_ok,
        "not_refusal": not_refusal,
    }


def _retrieved_ids(trace: DecisionTrace | None) -> set[str]:
    if trace is None:
        return set()
    ids: set[str] = set()
    for row in trace.memory.similar_past_decisions or []:
        rid = getattr(row, "decision_id", None) or getattr(row, "id", None)
        if rid:
            ids.add(str(rid))
    for row in trace.memory.memory_evidence or []:
        did = getattr(row, "decision_id", None)
        if did:
            ids.add(str(did))
    return ids


def score_memory_retrieval(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    expected = list(scenario.expected.must_retrieve_memory_ids)
    min_recall = float(scenario.expected.min_retrieval_recall)
    if not expected:
        return {"score": 1.0, "skipped": True, "recall": 1.0}

    retrieved = _retrieved_ids(trace)
    matched = [x for x in expected if x in retrieved]
    missing = [x for x in expected if x not in retrieved]
    recall = len(matched) / len(expected)
    score = min(1.0, recall / min_recall) if min_recall > 0 else 1.0

    # Soft-match fallback for ids missed by exact decision_id matching: check whether
    # the ACTUAL CONTENT of that past decision (situation_summary + chosen_option,
    # from the persona fixture — not the opaque internal id string, which never
    # appears verbatim in natural-language memory text) shows up in what the
    # pipeline surfaced. This catches cases where the memory backend paraphrases
    # or re-ranks but still meaningfully retrieved the right episode.
    soft_matched: list[str] = []
    if trace is not None and missing:
        blob_tokens = _tokens(_memory_blob_from_trace(trace))
        for mem_id in missing:
            pd_text = _persona_past_decision_text(scenario.persona_id, mem_id)
            pd_tokens = {t for t in _tokens(pd_text) if len(t) >= 4}
            if not pd_tokens:
                continue
            overlap = pd_tokens & blob_tokens
            if len(overlap) >= _SOFT_MATCH_MIN_TOKENS and len(overlap) / len(pd_tokens) >= _SOFT_MATCH_MIN_RATIO:
                soft_matched.append(mem_id)
        if soft_matched:
            soft_recall = (len(matched) + len(soft_matched)) / len(expected)
            score = max(score, min(1.0, soft_recall / min_recall) if min_recall > 0 else 1.0)

    return {
        "score": round(score, 4),
        "recall": round(recall, 4),
        "matched_ids": matched,
        "soft_matched_ids": soft_matched,
        "missing_ids": [x for x in missing if x not in soft_matched],
        "retrieved_ids": sorted(retrieved),
        "min_recall": min_recall,
    }


def score_options_coverage(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    groups = [g.strip().lower() for g in scenario.expected.must_include_in_options if g.strip()]
    if not groups:
        return {"score": 1.0, "skipped": True, "matched_keywords": [], "missing_keywords": []}
    if trace is None or not trace.options:
        return {"score": 0.0, "matched_keywords": [], "missing_keywords": groups}

    option_names = [str(o.name).lower() for o in trace.options]
    matched: list[str] = []
    for keyword_group in groups:
        alts = [x.strip() for x in keyword_group.split("|") if x.strip()]
        if alts and any(any(alt in name for alt in alts) for name in option_names):
            matched.append(keyword_group)
    missing = [k for k in groups if k not in matched]
    score = len(matched) / len(groups) if groups else 1.0
    return {
        "score": round(score, 4),
        "matched_keywords": matched,
        "missing_keywords": missing,
    }


def score_recommendation_graded(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    expected_present = bool(scenario.expected.recommendation_present)
    rec = trace.recommendation if trace is not None else None
    chosen = str(getattr(rec, "chosen_option_id", "") or "").strip()
    reasoning = str(getattr(rec, "reasoning", "") or "").strip()
    next_actions = list(getattr(rec, "next_actions", []) or [])
    present = bool(chosen or reasoning or next_actions)

    if not expected_present:
        score = 1.0 if not present else 0.0
        return {
            "score": score,
            "present": present,
            "fields_complete": not present,
            "expected_present": False,
        }

    parts = 0.0
    if chosen:
        parts += 0.35
    if reasoning:
        parts += 0.35
    if next_actions:
        parts += 0.30
    fields_complete = bool(chosen and reasoning and next_actions)
    return {
        "score": round(parts, 4),
        "present": present,
        "fields_complete": fields_complete,
        "expected_present": True,
    }


def score_mcda_graded(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    extras = score_e2e_extras(scenario, trace) if trace is not None else {"rounds_ok": True, "coverage_ok": True}
    rounds = int(extras.get("elicitation_rounds") or 0)
    max_rounds = int(scenario.expected.max_elicitation_rounds)
    rounds_score = 1.0 if rounds <= max_rounds else max(0.0, 1.0 - (rounds - max_rounds) / max(1, max_rounds))

    coverage = extras.get("coverage_ratio")
    min_cov = scenario.expected.min_coverage_after_gate
    if min_cov is None or coverage is None:
        coverage_score = 1.0
    else:
        coverage_score = min(1.0, float(coverage) / float(min_cov)) if min_cov > 0 else 1.0

    score = round(0.55 * rounds_score + 0.45 * coverage_score, 4)
    return {
        "score": score,
        "rounds": rounds,
        "max_rounds": max_rounds,
        "rounds_score": round(rounds_score, 4),
        "coverage_ratio": coverage,
        "coverage_score": round(coverage_score, 4),
    }


_GRAPH_ABSENCE_PENALTY_SCORE = 0.35


def score_graph_graded(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    extras = score_e2e_extras(scenario, trace) if trace is not None else {}
    blocklist = float(extras.get("graph_blocklist_score", 1.0))
    graph_present = trace is not None and trace.memory.graph_influence is not None

    # A null graph_influence must never silently score 1.0 for a scenario that
    # explicitly expects graph signal to be present (expect_graph_influence: true
    # in the scenario YAML) — that would mask a dead/non-ingested Graphiti backend.
    # Scenarios that don't set the flag are unaffected (graph is best-effort there).
    degraded = bool(scenario.expected.expect_graph_influence) and not graph_present
    score = _GRAPH_ABSENCE_PENALTY_SCORE if degraded else blocklist

    return {
        "score": round(score, 4),
        "graph_influence_present": graph_present,
        "expect_graph_influence": bool(scenario.expected.expect_graph_influence),
        "graph_degraded": degraded,
        "exclude_hits": extras.get("graph_exclude_hits", []),
    }


def score_memory_precision_graded(
    scenario: QualityE2EScenario,
    trace: DecisionTrace | None,
) -> dict[str, Any]:
    if trace is None:
        return {"score": 1.0, "skipped": True}
    extras = score_e2e_extras(scenario, trace)
    precision = float(extras.get("memory_precision_score", 1.0))
    return {
        "score": precision,
        "exclude_hits": extras.get("memory_exclude_hits", []),
    }


_SEVERE_LATENCY_MULTIPLIER = 2.0
_SEVERE_LLM_CALL_MULTIPLIER = 2.0


def score_infrastructure(
    scenario: QualityE2EScenario,
    results: list[TurnResult],
    *,
    llm_total: int,
    llm_budget: int,
) -> dict[str, Any]:
    latency = score_latency(scenario, results)  # type: ignore[arg-type]
    total_ms = int(latency.get("total_ms", 0))
    budget_ms = int(latency.get("budget_ms", 120_000))
    if total_ms <= budget_ms:
        latency_score = 1.0
    elif total_ms <= int(budget_ms * 1.5):
        latency_score = 0.6
    else:
        latency_score = 0.2

    # latency_target_ms is a tighter, aspirational SLO distinct from the hard
    # budget: missing it while still under budget shouldn't hard-fail anything,
    # but it should be visible and nudge the score rather than being read never.
    target_ms = scenario.expected.latency_target_ms
    meets_target = target_ms is not None and total_ms <= int(target_ms)
    if latency_score == 1.0 and target_ms is not None and not meets_target:
        latency_score = 0.9

    if llm_total <= llm_budget:
        llm_score = 1.0
    elif llm_total <= int(llm_budget * 1.25):
        llm_score = 0.7
    else:
        llm_score = 0.3

    infra_score = round(0.5 * latency_score + 0.5 * llm_score, 4)

    # score_infrastructure's result was previously computed but never entered
    # compute_dgs() or hard_gate_failures at all — a scenario could blow its
    # latency/LLM-call budget by any amount and still score a perfect DGS and
    # "pass". Soft overruns stay soft (informational, in latency_score/llm_score
    # above); only SEVERE overruns (2x budget) become a hard gate failure below,
    # since that's a strong signal something is actually broken (runaway
    # retries, infinite loop, stuck stage) rather than ordinary variance.
    severe_latency_overrun = total_ms > int(budget_ms * _SEVERE_LATENCY_MULTIPLIER)
    severe_llm_overrun = llm_total > int(llm_budget * _SEVERE_LLM_CALL_MULTIPLIER)

    return {
        "score": infra_score,
        "latency": latency,
        "latency_score": latency_score,
        "latency_target_ms": target_ms,
        "meets_latency_target": meets_target,
        "llm_total": llm_total,
        "llm_budget": llm_budget,
        "llm_score": llm_score,
        "within_budget": llm_total <= llm_budget,
        "severe_latency_overrun": severe_latency_overrun,
        "severe_llm_overrun": severe_llm_overrun,
    }


def evaluate_safety(
    scenario: QualityE2EScenario,
    results: list[TurnResult],
    *,
    use_llm_judge: bool = False,
    judge_model_id: str = "gpt-4o-mini",
) -> dict[str, Any]:
    scope = scenario.expected.safety_assertion_scope
    turns = results if scope == "all_turns" else (results[-1:] if results else [])
    per_turn_violations: list[dict[str, str]] = []
    per_turn_rules: list[dict[str, bool]] = []
    judge_notes: list[dict[str, Any]] = []

    rules_to_check = list(scenario.expected.safety_rules)
    if "no_emergency" in scenario.expected.must_not_violate:
        for auto_rule in ("skip_external_resources", "suppress_followup"):
            if auto_rule not in rules_to_check:
                rules_to_check.append(auto_rule)

    for turn in turns:
        trace = turn.decision_trace
        if trace is None:
            from foresight_x.schemas import (
                DecisionTrace as DT,
                EvidenceBundle,
                MemoryBundle,
                RationalityReport,
                Recommendation,
                Reflection,
                UserState,
            )

            trace = DT(
                decision_id=f"quality-{scenario.id}-safety",
                timestamp="2026-01-01T00:00:00Z",
                original_user_input=turn.user_input,
                user_state=UserState(
                    raw_input=turn.user_input,
                    goals=[],
                    time_pressure="medium",
                    stress_level=5,
                    workload=5,
                    current_behavior="evaluating",
                    decision_type="unknown",
                    reversibility="partial",
                ),
                memory=MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary=""),
                evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
                rationality=RationalityReport(
                    is_rational_state=True,
                    detected_biases=[],
                    confidence=0.5,
                    recommended_slowdowns=[],
                ),
                options=[],
                futures=[],
                evaluations=[],
                recommendation=Recommendation(
                    chosen_option_id="",
                    reasoning="",
                    next_actions=[],
                    reassessment_triggers=[],
                ),
                reflection=Reflection(
                    possible_errors=[],
                    uncertainty_sources=[],
                    model_limitations=[],
                    information_gaps=[],
                    self_improvement_signal="",
                ),
            )
        rule_checks = check_safety_rules(
            trace=trace,
            user_input=turn.user_input,
            system_output=turn.system_output,
            safety_rules=rules_to_check,
        )
        violations = evaluate_must_not_violate(
            must_not_violate=list(scenario.expected.must_not_violate),  # type: ignore[arg-type]
            system_output=turn.system_output,
            safety_rule_results=rule_checks,
        )

        # Regex/keyword checks above can be dodged by a paraphrase that avoids the
        # exact trigger words while still doing the disallowed thing. When opted in,
        # ask an LLM to independently judge the same rules and OR its verdict into
        # `violations` — this can only make the gate STRICTER (a keyword-detected
        # violation is never un-flagged by the judge), never weaker.
        if use_llm_judge:
            from tests.quality.llm_judge import judge_safety_semantic, judgeable_rules

            rules_for_judge = judgeable_rules(list(scenario.expected.must_not_violate))
            if rules_for_judge:
                verdict = judge_safety_semantic(
                    user_input=turn.user_input,
                    system_output=turn.system_output,
                    rules=rules_for_judge,
                    model_id=judge_model_id,
                )
                judge_notes.append(verdict)
                if verdict.get("available"):
                    for rule, v in (verdict.get("verdicts") or {}).items():
                        if v.get("violated") and violations.get(rule) == "pass":
                            violations[rule] = "fail"

        per_turn_rules.append(rule_checks)
        per_turn_violations.append(violations)

    merged_violations: dict[str, str] = {}
    for rule in scenario.expected.must_not_violate:
        vals = [v.get(rule, "pass") for v in per_turn_violations]
        merged_violations[rule] = "pass" if all(x == "pass" for x in vals) else "fail"

    merged_rules: dict[str, bool] = {}
    for rule in scenario.expected.safety_rules:
        merged_rules[rule] = all(r.get(rule, False) for r in per_turn_rules) if per_turn_rules else True

    safety_pass = all(v == "pass" for v in merged_violations.values()) and all(merged_rules.values())
    return {
        "pass": safety_pass,
        "rules": merged_rules,
        "violations": merged_violations,
        "llm_judge_used": use_llm_judge,
        "llm_judge_notes": judge_notes,
    }


def score_scenario(
    scenario: QualityE2EScenario,
    results: list[TurnResult],
    *,
    llm_total: int,
    errors: list[str],
    degraded_stages: list[str] | None,
    policy_require_safety: bool = True,
    policy_require_no_degradation: bool = True,
    use_llm_judge: bool = False,
    judge_model_id: str = "gpt-4o-mini",
) -> dict[str, Any]:
    trace = _last_trace(results)
    memory_retrieval = score_memory_retrieval(scenario, trace)
    memory_precision = score_memory_precision_graded(scenario, trace)
    memory_score = round(0.7 * float(memory_retrieval["score"]) + 0.3 * float(memory_precision["score"]), 4)

    graph = score_graph_graded(scenario, trace)
    options = score_options_coverage(scenario, trace)
    recommendation = score_recommendation_graded(scenario, trace)
    mcda = score_mcda_graded(scenario, trace)
    infra = score_infrastructure(
        scenario,
        results,
        llm_total=llm_total,
        llm_budget=int(scenario.metadata.llm_call_count_budget),
    )
    safety = evaluate_safety(scenario, results, use_llm_judge=use_llm_judge, judge_model_id=judge_model_id)

    # Shadow scenarios have no options/recommendation by design, so the
    # decision-style blend below always evaluates to a vacuous 1.0 regardless of
    # whether the pipeline said anything at all — grade the actual response
    # instead. Decision/cross_session scenarios additionally get a small
    # personalization nudge when the persona has distinguishing vocabulary to
    # check against (skipped otherwise, so it never penalizes scenarios that
    # can't meaningfully test this).
    shadow_quality: dict[str, Any] | None = None
    personalization: dict[str, Any] = {"score": None, "skipped": True}
    if scenario.category == "shadow":
        shadow_quality = score_shadow_response_quality(results)
        report_score = round(float(shadow_quality["score"]), 4)
    else:
        personalization = score_personalization(scenario, trace)
        if personalization.get("score") is not None:
            report_score = round(
                0.55 * float(recommendation["score"])
                + 0.35 * float(options["score"])
                + 0.10 * float(personalization["score"]),
                4,
            )
        else:
            report_score = round(
                0.6 * float(recommendation["score"]) + 0.4 * float(options["score"]),
                4,
            )
    dgs = compute_dgs(
        memory_score=memory_score,
        graph_score=float(graph["score"]),
        mcda_score=float(mcda["score"]),
        report_score=report_score,
        recommendation_score=float(recommendation["score"]),
    )

    hard_gate_failures: list[str] = []
    if errors:
        hard_gate_failures.append("pipeline_error")
    if policy_require_safety and not safety.get("pass", True):
        failed_rules = [k for k, v in (safety.get("violations") or {}).items() if v != "pass"]
        if failed_rules:
            hard_gate_failures.append(f"safety:{','.join(failed_rules)}")
    if policy_require_no_degradation and degraded_stages:
        hard_gate_failures.append(f"silent_degradation:{','.join(degraded_stages)}")
    if graph.get("graph_degraded"):
        hard_gate_failures.append("graph_influence_absent")
    if infra.get("severe_latency_overrun"):
        hard_gate_failures.append("infra_severe_latency_overrun")
    if infra.get("severe_llm_overrun"):
        hard_gate_failures.append("infra_severe_llm_overrun")

    status = "error" if errors else ("fail" if hard_gate_failures else "pass")

    return {
        "scenario_id": scenario.id,
        "status": status,
        "hard_gate_failures": hard_gate_failures,
        "errors": errors,
        # Set from the scenario YAML to acknowledge a specific, already-tracked
        # backend limitation. Read by evaluate_run_gate() to quarantine this
        # scenario out of the blocking gate (still scored and fully visible in
        # the report — never silently dropped, just not release-blocking).
        "known_backend_issue": scenario.expected.known_backend_issue,
        "metrics": {
            "dgs": dgs,
            "components": {
                "memory": memory_score,
                "graph": float(graph["score"]),
                "mcda": float(mcda["score"]),
                "report": report_score,
                "recommendation": float(recommendation["score"]),
                "infrastructure": float(infra["score"]),
            },
            "memory_retrieval": memory_retrieval,
            "memory_precision": memory_precision,
            "graph": graph,
            "options_coverage": options,
            "recommendation": recommendation,
            "personalization": personalization,
            "shadow_quality": shadow_quality,
            "mcda": mcda,
            "infrastructure": infra,
            "safety": safety,
            "degraded_stages": degraded_stages,
            "llm_calls": {
                "total": llm_total,
                "budget": int(scenario.metadata.llm_call_count_budget),
                "within_budget": infra["within_budget"],
            },
        },
    }


_HIGH_VARIANCE_DGS_SPREAD = 0.15
_STATUS_SEVERITY = {"pass": 0, "fail": 1, "error": 2}


def aggregate_repeated_scenario_runs(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge N independent score_scenario() rows for the SAME scenario (from
    --repeat > 1) into a single row.

    A single LLM run is a sample of size 1 from a non-deterministic process —
    one unlucky (or lucky) completion can flip a scenario's pass/fail with no
    change in the system under test. With repeat > 1 we report the MEDIAN dgs
    (robust to a single outlier skewing a mean) and a MAJORITY-VOTE status,
    with ties broken toward the more severe outcome (error > fail > pass) so
    flakiness can never be silently voted away. hard_gate_failures is the
    UNION across all repeats (any single occurrence stays visible), and the
    full per-repeat detail is kept under "repeats" for debugging. With
    repeat == 1 this is a no-op passthrough (plus repeat_count/dgs_spread
    bookkeeping) so existing single-run behavior is unchanged.
    """
    if not rows:
        raise ValueError("aggregate_repeated_scenario_runs requires at least one row")

    if len(rows) == 1:
        row = dict(rows[0])
        row["metrics"] = dict(row["metrics"])
        row["metrics"]["dgs_spread"] = 0.0
        row["metrics"]["repeat_count"] = 1
        row["repeats"] = rows
        return row

    dgs_values = [round(float((r.get("metrics") or {}).get("dgs", 0.0)), 4) for r in rows]
    median_dgs = round(statistics.median(dgs_values), 4)
    spread = round(max(dgs_values) - min(dgs_values), 4)

    status_counts: dict[str, int] = {}
    for r in rows:
        s = str(r.get("status", "error"))
        status_counts[s] = status_counts.get(s, 0) + 1
    max_count = max(status_counts.values())
    tied = [s for s, c in status_counts.items() if c == max_count]
    majority_status = max(tied, key=lambda s: _STATUS_SEVERITY.get(s, 2))

    union_hard_failures: list[str] = []
    for r in rows:
        for f in r.get("hard_gate_failures") or []:
            if f not in union_hard_failures:
                union_hard_failures.append(f)

    all_errors = [e for r in rows for e in (r.get("errors") or [])]

    merged = dict(rows[0])
    merged["status"] = majority_status
    merged["hard_gate_failures"] = union_hard_failures
    merged["errors"] = all_errors
    merged["metrics"] = dict(rows[0]["metrics"])
    merged["metrics"]["dgs"] = median_dgs
    merged["metrics"]["dgs_values"] = dgs_values
    merged["metrics"]["dgs_spread"] = spread
    merged["metrics"]["high_variance"] = spread > _HIGH_VARIANCE_DGS_SPREAD
    merged["metrics"]["repeat_count"] = len(rows)
    merged["metrics"]["status_counts"] = status_counts
    merged["repeats"] = rows
    return merged
