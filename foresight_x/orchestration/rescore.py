"""Rescore an existing decision trace after scoring clarification."""

from __future__ import annotations

from typing import Any

from foresight_x.decision.weight_audit import build_weight_audit, composite_map
from foresight_x.decision.report_surface import build_report_surface
from foresight_x.config import load_settings
from foresight_x.memory.profile_store import empty_profile, load_profile
from foresight_x.decision.reflector import reflect
from foresight_x.harness.trace import save_decision_trace
from foresight_x.orchestration.degradation_policy import safe_recommend, safe_reflect
from foresight_x.simulation.scoring_clarify_gate import recommendation_is_provisional
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    RationalityReport,
    SimulatedFuture,
    UserState,
)
from foresight_x.simulation.feature_audit import evaluate_with_audit


def _risk_posture_from_settings(settings: Any | None) -> str | None:
    if settings is None:
        return None
    try:
        profile = load_profile(settings.foresight_user_id) or empty_profile(settings.foresight_user_id)
        return profile.risk_posture
    except Exception:
        return None


def rescore_trace(
    trace: DecisionTrace,
    *,
    scoring_clarification: dict[str, str] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
    llm: Any | None = None,
    persist_trace: bool = True,
    settings: Any | None = None,
    anchor_now_iso: str | None = None,
) -> DecisionTrace:
    """Re-run feature extraction + scoring with new clarification answers."""
    merged_clarify = dict(trace.scoring_clarification or {})
    if scoring_clarification:
        merged_clarify.update(scoring_clarification)

    evaluations, audit, options = evaluate_with_audit(
        trace.options,
        trace.user_state,
        trace.evidence,
        trace.memory,
        trace.futures,
        merged_clarify or None,
        confirmed_candidates,
        risk_posture=_risk_posture_from_settings(settings),
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
        confirmed_candidates=confirmed_candidates,
        llm=llm,
        persist_trace=persist_trace,
        settings=settings,
        anchor_now_iso=anchor_now_iso,
    )
