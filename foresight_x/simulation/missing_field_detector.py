"""Targeted scoring clarify questions from missing unknown features."""

from __future__ import annotations

from foresight_x.simulation.feature_registry import (
    FEATURE_LABELS,
    QUESTION_TEMPLATES,
    feature_label,
)
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    FeatureAuditBundle,
    OptionFeatureVector,
    ScoringClarifyQuestion,
)

COVERAGE_CLARIFY_THRESHOLD = 0.55
MAX_QUESTIONS_PER_RUN = 6


def _missing_unknown_keys(fv: OptionFeatureVector) -> list[str]:
    statuses = fv.field_status or {}
    missing: list[str] = []
    for key in CRITICAL_FEATURE_KEYS:
        st = statuses.get(key, "unknown")
        if st == "known":
            continue
        if st == "unknown" or getattr(fv, key, "unknown") == "unknown":
            missing.append(key)
    return missing


def _field_answered(
    option_id: str,
    feature_key: str,
    *,
    existing_clarification: dict[str, str] | None,
) -> bool:
    if not existing_clarification:
        return False
    return f"{option_id}:{feature_key}" in existing_clarification


def _comparative_answered(
    feature_key: str,
    *,
    existing_comparative: dict[str, list[str]] | None,
) -> bool:
    if not existing_comparative:
        return False
    return f"cmp:{feature_key}:rank" in existing_comparative


def build_clarify_questions(
    feature_vectors: list[OptionFeatureVector],
    options_by_id: dict[str, str],
    *,
    existing_clarification: dict[str, str] | None = None,
    existing_comparative: dict[str, list[str]] | None = None,
) -> list[ScoringClarifyQuestion]:
    """One targeted question per unknown critical feature (cap per run), excluding answered."""
    questions: list[ScoringClarifyQuestion] = []
    seen: set[str] = set()
    for fv in feature_vectors:
        option_name = options_by_id.get(fv.option_id, fv.option_id)
        for key in _missing_unknown_keys(fv):
            qkey = f"{fv.option_id}:{key}"
            if qkey in seen:
                continue
            if _field_answered(fv.option_id, key, existing_clarification=existing_clarification):
                continue
            if _comparative_answered(key, existing_comparative=existing_comparative):
                continue
            seen.add(qkey)
            tmpl = QUESTION_TEMPLATES.get(key, "What is the {label} for {option_name}?")
            label = feature_label(key)
            prompt = tmpl.format(option_name=option_name, label=label)
            questions.append(
                ScoringClarifyQuestion(
                    id=qkey,
                    feature_key=key,
                    option_id=fv.option_id,
                    prompt=prompt,
                    answer_type="level",
                    choices=["low", "medium", "high", "not sure"],
                )
            )
            if len(questions) >= MAX_QUESTIONS_PER_RUN:
                return questions
    return questions


def collect_missing_fields(feature_vectors: list[OptionFeatureVector]) -> list[str]:
    out: list[str] = []
    for fv in feature_vectors:
        for key in _missing_unknown_keys(fv):
            token = f"{fv.option_id}:{key}"
            if token not in out:
                out.append(token)
    return out


def needs_scoring_clarification(coverage: float, feature_vectors: list[OptionFeatureVector]) -> bool:
    from foresight_x.simulation.alignment_engine import cross_option_discrimination, needs_elicitation

    disc = cross_option_discrimination(feature_vectors)
    return needs_elicitation(coverage, feature_vectors, discrimination=disc)


def enrich_audit_bundle(
    audit: FeatureAuditBundle,
    options_by_id: dict[str, str],
    *,
    evaluations: list | None = None,
    risk_posture: str | None = None,
    options: list | None = None,
    user_state=None,
    existing_clarification: dict[str, str] | None = None,
    existing_comparative: dict[str, list[str]] | None = None,
    tag_quality_reports: list | None = None,
) -> FeatureAuditBundle:
    from foresight_x.simulation.alignment_engine import build_alignment_report, cross_option_discrimination
    from foresight_x.simulation.clarify_voi import rank_questions_by_voi
    from foresight_x.simulation.comparative_elicitation import build_comparative_questions
    from foresight_x.simulation.feature_merge import grounded_coverage

    coverage = grounded_coverage(audit.feature_vectors)
    missing = collect_missing_fields(audit.feature_vectors)
    questions = build_clarify_questions(
        audit.feature_vectors,
        options_by_id,
        existing_clarification=existing_clarification,
        existing_comparative=existing_comparative,
    )
    if evaluations and questions:
        questions = rank_questions_by_voi(
            questions,
            audit.feature_vectors,
            evaluations,
            risk_posture=risk_posture,
        )
    voi_order = [q.id for q in questions]

    disc = cross_option_discrimination(audit.feature_vectors)
    comparative: list = []
    if options and len(options) >= 2:
        comparative_raw = build_comparative_questions(
            options,
            audit.feature_vectors,
            existing_comparative=existing_comparative,
        )
        comparative = [
            q.model_copy(update={"option_labels": {oid: options_by_id.get(oid, oid) for oid in q.choices}})
            for q in comparative_raw
        ]

    alignment = None
    if user_state is not None:
        alignment = build_alignment_report(
            user_state,
            audit.feature_vectors,
            evaluations,
            risk_posture=risk_posture,
            coverage=coverage,
            tag_quality_reports=tag_quality_reports or audit.tag_quality_reports,
            existing_clarification=existing_clarification,
            existing_comparative=existing_comparative,
        )

    has_questions = bool(questions or comparative)
    needs = needs_scoring_clarification(coverage, audit.feature_vectors) and has_questions

    return audit.model_copy(
        update={
            "grounded_feature_coverage": round(coverage, 3),
            "cross_option_discrimination": round(disc, 3),
            "missing_fields": missing,
            "clarify_questions": questions,
            "comparative_questions": comparative,
            "needs_scoring_clarification": needs,
            "voi_question_order": voi_order,
            "alignment_report": alignment,
        }
    )


# Backward-compatible re-export for modules that import FEATURE_LABELS from here.
__all__ = [
    "COVERAGE_CLARIFY_THRESHOLD",
    "FEATURE_LABELS",
    "MAX_QUESTIONS_PER_RUN",
    "QUESTION_TEMPLATES",
    "build_clarify_questions",
    "collect_missing_fields",
    "enrich_audit_bundle",
    "needs_scoring_clarification",
]
