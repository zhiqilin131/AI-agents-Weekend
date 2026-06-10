"""Rescore an existing decision trace after scoring clarification."""

from __future__ import annotations

from typing import Any

from foresight_x.decision.weight_audit import build_weight_audit, composite_map
from foresight_x.decision.report_surface import build_report_surface
from foresight_x.memory.profile_store import empty_profile, load_profile
from foresight_x.harness.trace import save_decision_trace
from foresight_x.orchestration.degradation_policy import safe_recommend, safe_reflect
from foresight_x.simulation.scoring_clarify_gate import recommendation_is_provisional
from foresight_x.simulation.elicitation_service import merge_elicitation_answers, record_elicitation_round
from foresight_x.schemas import DecisionTrace
from foresight_x.simulation.feature_audit import evaluate_with_audit


def _risk_posture_from_settings(settings: Any | None) -> str | None:
    if settings is None:
        return None
    try:
        profile = load_profile(settings.foresight_user_id) or empty_profile(settings.foresight_user_id)
        return profile.risk_posture
    except Exception:
        return None


def _merge_comparative_on_trace(
    trace: DecisionTrace,
    new_answers: dict[str, list[str]],
) -> dict[str, list[str]] | None:
    merged = dict(trace.comparative_answers or {})
    merged.update(new_answers)
    return merged or None


def rescore_trace(
    trace: DecisionTrace,
    *,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
    llm: Any | None = None,
    persist_trace: bool = True,
    settings: Any | None = None,
    anchor_now_iso: str | None = None,
) -> DecisionTrace:
    """Re-run feature extraction + scoring with new clarification answers."""
    coverage_before = 0.0
    if trace.feature_audit and isinstance(trace.feature_audit, dict):
        coverage_before = float(trace.feature_audit.get("grounded_feature_coverage") or 0.0)

    merged_clarify, valid_cmp, merge_errors = merge_elicitation_answers(
        scoring_clarification=scoring_clarification,
        comparative_answers=comparative_answers,
        existing_clarification=dict(trace.scoring_clarification or {}),
        option_ids={o.option_id for o in trace.options},
    )
    merged_cmp = dict(trace.comparative_answers or {})
    merged_cmp.update(valid_cmp)

    evaluations, audit, options = evaluate_with_audit(
        trace.options,
        trace.user_state,
        trace.evidence,
        trace.memory,
        trace.futures,
        merged_clarify or None,
        confirmed_candidates,
        risk_posture=_risk_posture_from_settings(settings),
        comparative_answers=merged_cmp or None,
    )

    recommendation, _, _ = safe_recommend(
        evaluations,
        options,
        trace.evidence,
        trace.memory,
        user_state=trace.user_state,
        llm=llm,
        anchor_now_iso=anchor_now_iso,
    )
    rp = _risk_posture_from_settings(settings)
    composite_by_id, applied_w = composite_map(evaluations, rp)
    weight_audit = build_weight_audit(
        evaluations,
        composite_by_option_id=composite_by_id,
        winner_id=recommendation.chosen_option_id,
        risk_posture=rp,
        applied_weights=applied_w,
    )

    updated = trace.model_copy(
        update={
            "options": options,
            "evaluations": evaluations,
            "recommendation": recommendation,
            "feature_audit": audit.model_dump(mode="json"),
            "scoring_clarification": merged_clarify or None,
            "comparative_answers": _merge_comparative_on_trace(trace, valid_cmp),
            "scoring_elicitation_rounds": record_elicitation_round(
                trace.scoring_elicitation_rounds,
                comparative_answers=valid_cmp,
                scoring_clarification=dict(scoring_clarification or {}),
                coverage_before=coverage_before,
                coverage_after=audit.grounded_feature_coverage,
                discrimination_after=audit.cross_option_discrimination,
                source="refine",
            ),
            "weight_audit": weight_audit,
        }
    )
    provisional = recommendation_is_provisional(
        audit,
        allow_provisional=False,
        clarification_attempted=bool(merged_clarify),
    )
    updated = updated.model_copy(update={"scoring_recommendation_provisional": provisional})
    reflection, _, _ = safe_reflect(updated, llm)
    updated = updated.model_copy(
        update={
            "reflection": reflection,
            "report_surface": build_report_surface(updated),
        }
    )
    if persist_trace and settings is not None:
        save_decision_trace(updated, settings=settings)
    return updated


def rescore_from_dict(
    payload: dict[str, Any],
    *,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
    llm: Any | None = None,
    persist_trace: bool = False,
    settings: Any | None = None,
    anchor_now_iso: str | None = None,
) -> DecisionTrace:
    trace = DecisionTrace.model_validate(payload)
    return rescore_trace(
        trace,
        scoring_clarification=scoring_clarification,
        comparative_answers=comparative_answers,
        confirmed_candidates=confirmed_candidates,
        llm=llm,
        persist_trace=persist_trace,
        settings=settings,
        anchor_now_iso=anchor_now_iso,
    )
