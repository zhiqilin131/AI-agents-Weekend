"""Targeted scoring clarify questions from missing unknown features."""

from __future__ import annotations

from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    FeatureAuditBundle,
    FeatureLevel,
    OptionFeatureVector,
    ScoringClarifyQuestion,
)

FEATURE_LABELS: dict[str, str] = {
    "time_cost_level": "time cost",
    "money_cost_level": "money cost",
    "stress_load_level": "stress load",
    "workload_level": "workload",
    "reversibility_level": "reversibility",
    "downside_severity_level": "downside severity",
    "upside_potential_level": "upside potential",
    "goal_alignment_level": "goal alignment",
}

QUESTION_TEMPLATES: dict[str, str] = {
    "time_cost_level": "How much time would {option_name} realistically require?",
    "money_cost_level": "Would {option_name} materially change your money situation?",
    "stress_load_level": "How stressful would {option_name} be for you?",
    "workload_level": "How heavy is the workload for {option_name}?",
    "reversibility_level": "How easy would it be to reverse {option_name} if it goes wrong?",
    "downside_severity_level": "If {option_name} fails, how bad could the downside be?",
    "upside_potential_level": "How much upside does {option_name} offer toward your goals?",
    "goal_alignment_level": "How well does {option_name} fit your stated goals?",
}

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


def build_clarify_questions(
    feature_vectors: list[OptionFeatureVector],
    options_by_id: dict[str, str],
) -> list[ScoringClarifyQuestion]:
    """One targeted question per unknown critical feature (cap per run)."""
    questions: list[ScoringClarifyQuestion] = []
    seen: set[str] = set()
    for fv in feature_vectors:
        option_name = options_by_id.get(fv.option_id, fv.option_id)
        for key in _missing_unknown_keys(fv):
            qkey = f"{fv.option_id}:{key}"
            if qkey in seen:
                continue
            seen.add(qkey)
            tmpl = QUESTION_TEMPLATES.get(key, "What is the {label} for {option_name}?")
            label = FEATURE_LABELS.get(key, key)
            prompt = tmpl.format(option_name=option_name, label=label)
            questions.append(
                ScoringClarifyQuestion(
                    id=f"{fv.option_id}:{key}",
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
    if coverage >= COVERAGE_CLARIFY_THRESHOLD:
        return False
    return any(_missing_unknown_keys(fv) for fv in feature_vectors)


def enrich_audit_bundle(
    audit: FeatureAuditBundle,
    options_by_id: dict[str, str],
    *,
    evaluations: list | None = None,
    risk_posture: str | None = None,
) -> FeatureAuditBundle:
    from foresight_x.simulation.feature_merge import grounded_coverage
    from foresight_x.simulation.clarify_voi import rank_questions_by_voi

    coverage = grounded_coverage(audit.feature_vectors)
    missing = collect_missing_fields(audit.feature_vectors)
    questions = build_clarify_questions(audit.feature_vectors, options_by_id)
    if evaluations and questions:
        questions = rank_questions_by_voi(
            questions,
            audit.feature_vectors,
            evaluations,
            risk_posture=risk_posture,
        )
    voi_order = [q.id for q in questions]
    return audit.model_copy(
        update={
            "grounded_feature_coverage": round(coverage, 3),
            "missing_fields": missing,
            "clarify_questions": questions,
            "needs_scoring_clarification": needs_scoring_clarification(coverage, audit.feature_vectors),
            "voi_question_order": voi_order,
        }
    )
