"""Build FeatureAuditBundle and rescore pipeline."""

from __future__ import annotations

from foresight_x.schemas import (
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    SimulatedFuture,
    UserState,
)
from foresight_x.simulation.feature_scorer import score_options_from_features
from foresight_x.simulation.feature_candidate_extractor import extract_candidates_from_futures
from foresight_x.simulation.feature_confirmation import (
    apply_confirmed_candidates,
    apply_scoring_clarification_to_options,
)
from foresight_x.simulation.feature_extractor import extract_features_for_options
from foresight_x.simulation.feature_merge import ensure_option_tags, grounded_coverage
from foresight_x.simulation.feature_schemas import FeatureAuditBundle
from foresight_x.simulation.future_reliability import assess_futures_reliability
from foresight_x.simulation.missing_field_detector import enrich_audit_bundle
from foresight_x.simulation.tag_quality_audit import audit_all_option_tags


def build_feature_audit(
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
    futures: list[SimulatedFuture] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
    evaluations: list[OptionEvaluation] | None = None,
    risk_posture: str | None = None,
) -> FeatureAuditBundle:
    opts = ensure_option_tags(list(options))
    opts = apply_scoring_clarification_to_options(opts, scoring_clarification)
    opts = apply_confirmed_candidates(opts, confirmed_candidates)
    tag_reports = audit_all_option_tags(opts, evidence)
    fvs = extract_features_for_options(opts, user_state, evidence, memory, scoring_clarification)
    rel = assess_futures_reliability(futures or [], opts, user_state, evidence)
    candidates = extract_candidates_from_futures(futures or [])
    if evaluations is None:
        evaluations = score_options_from_features(fvs, reliability_by_option=rel)
    audit = FeatureAuditBundle(
        feature_vectors=fvs,
        reliability_reports=list(rel.values()),
        candidates=candidates,
        grounded_feature_coverage=grounded_coverage(fvs),
        tag_quality_reports=tag_reports,
    )
    names = {o.option_id: o.name for o in opts}
    return enrich_audit_bundle(
        audit,
        names,
        evaluations=evaluations,
        risk_posture=risk_posture,
    )


def evaluate_with_audit(
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
    futures: list[SimulatedFuture] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    confirmed_candidates: list[dict[str, str]] | None = None,
    risk_posture: str | None = None,
) -> tuple[list[OptionEvaluation], FeatureAuditBundle, list[Option]]:
    opts = ensure_option_tags(list(options))
    opts = apply_scoring_clarification_to_options(opts, scoring_clarification)
    opts = apply_confirmed_candidates(opts, confirmed_candidates)
    tag_reports = audit_all_option_tags(opts, evidence)
    fvs = extract_features_for_options(opts, user_state, evidence, memory, scoring_clarification)
    rel = assess_futures_reliability(futures or [], opts, user_state, evidence)
    candidates = extract_candidates_from_futures(futures or [])
    evaluations = score_options_from_features(
        fvs,
        reliability_by_option=rel,
    )
    audit = FeatureAuditBundle(
        feature_vectors=fvs,
        reliability_reports=list(rel.values()),
        candidates=candidates,
        grounded_feature_coverage=grounded_coverage(fvs),
        tag_quality_reports=tag_reports,
    )
    names = {o.option_id: o.name for o in opts}
    audit = enrich_audit_bundle(
        audit,
        names,
        evaluations=evaluations,
        risk_posture=risk_posture,
    )
    return evaluations, audit, opts
