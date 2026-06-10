"""Auditable feature vectors and futures reliability reports for deterministic MCDA."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FeatureLevel = Literal["low", "medium", "high", "unknown"]
FeatureStatus = Literal["unknown", "candidate", "known"]
FeatureSourceType = Literal[
    "user_statement",
    "profile_memory",
    "world_evidence",
    "option_text",
    "option_tags",
    "rule",
    "tool",
    "llm_inferred",
    "scoring_clarification",
    "comparative_elicitation",
]
FutureScoreUse = Literal["score_eligible", "explanation_only", "needs_more_info", "discard"]
OptionTagSource = Literal["template", "llm_tagging", "user", "rule"]

CRITICAL_FEATURE_KEYS = (
    "time_cost_level",
    "money_cost_level",
    "stress_load_level",
    "workload_level",
    "reversibility_level",
    "downside_severity_level",
    "upside_potential_level",
    "goal_alignment_level",
)

# Proxy / structural attributes — rule-derived values stay candidate unless user/tags confirm.
PROXY_FEATURE_KEYS = frozenset({
    "reversibility_level",
    "switching_cost_level",
    "opportunity_cost_level",
})


class FeatureProvenance(BaseModel):
    feature_key: str
    value: str
    source_type: FeatureSourceType
    source_ref: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    note: str = ""


class OptionFeatureVector(BaseModel):
    option_id: str
    time_cost_level: FeatureLevel = "unknown"
    money_cost_level: FeatureLevel = "unknown"
    stress_load_level: FeatureLevel = "unknown"
    workload_level: FeatureLevel = "unknown"
    reversibility_level: FeatureLevel = "unknown"
    switching_cost_level: FeatureLevel = "unknown"
    downside_severity_level: FeatureLevel = "unknown"
    upside_potential_level: FeatureLevel = "unknown"
    goal_alignment_level: FeatureLevel = "unknown"
    constraint_conflict_level: FeatureLevel = "unknown"
    opportunity_cost_level: FeatureLevel = "unknown"
    missing_critical_info_count: int = Field(default=0, ge=0)
    hard_constraint_violations: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    provenance: list[FeatureProvenance] = Field(default_factory=list)
    field_status: dict[str, FeatureStatus] = Field(default_factory=dict)


class FutureReliabilityReport(BaseModel):
    option_id: str
    score_use: FutureScoreUse = "explanation_only"
    structure_validity: float = Field(ge=0.0, le=1.0)
    probability_validity: float = Field(ge=0.0, le=1.0)
    grounding_coverage: float = Field(ge=0.0, le=1.0)
    scenario_consistency: float = Field(ge=0.0, le=1.0)
    decision_relevance: float = Field(ge=0.0, le=1.0)
    probability_justifiability: float = Field(ge=0.0, le=1.0)
    missing_scoring_fields: list[str] = Field(default_factory=list)
    allowed_uses: list[str] = Field(default_factory=list)
    blocked_uses: list[str] = Field(default_factory=list)


class FeatureCandidate(BaseModel):
    option_id: str
    feature_key: str
    proposed_level: FeatureLevel
    source_type: Literal["future_narrative", "llm_inferred"] = "future_narrative"
    source_ref: str = ""
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    note: str = ""
    confirmation_question: str = ""


class ScoringClarifyQuestion(BaseModel):
    id: str
    feature_key: str
    option_id: str | None = None
    prompt: str
    answer_type: Literal["level", "yes_no", "free_text", "rank"] = "level"
    choices: list[str] = Field(default_factory=lambda: ["low", "medium", "high", "not sure"])
    voi_score: float = Field(default=0.0, ge=0.0, description="Approximate value-of-information for ranking.")
    option_labels: dict[str, str] = Field(
        default_factory=dict,
        description="option_id → display name for rank questions",
    )


class AlignmentViolation(BaseModel):
    type: Literal["constraint_conflict", "comparative_inconsistent", "tag_evidence_conflict"] = "constraint_conflict"
    option_id: str = ""
    feature_key: str = ""
    user_constraint_ref: str = ""
    severity: Literal["blocker", "warning"] = "warning"
    message: str = ""


class AlignmentReport(BaseModel):
    cross_option_discrimination: float = Field(default=0.0, ge=0.0, le=1.0)
    constraint_violations: list[AlignmentViolation] = Field(default_factory=list)
    near_duplicate_options: bool = False
    clarity_test_passed: bool = False
    reconcile_required: bool = False
    coverage: float = Field(default=0.0, ge=0.0, le=1.0)
    needs_comparative_elicitation: bool = False


class ElicitationRound(BaseModel):
    round_id: str = ""
    timestamp: str = ""
    comparative_answers: dict[str, list[str]] = Field(default_factory=dict)
    scoring_clarification: dict[str, str] = Field(default_factory=dict)
    coverage_before: float = Field(default=0.0, ge=0.0, le=1.0)
    coverage_after: float = Field(default=0.0, ge=0.0, le=1.0)
    discrimination_after: float = Field(default=0.0, ge=0.0, le=1.0)
    source: Literal["gate", "refine", "rescore"] = "gate"


class TagQualityReport(BaseModel):
    option_id: str
    coverage_tagged: float = Field(ge=0.0, le=1.0, default=0.0)
    text_conflicts: list[str] = Field(default_factory=list)
    evidence_support_count: int = Field(default=0, ge=0)
    passes_quality_gate: bool = True


class FeatureAuditBundle(BaseModel):
    feature_vectors: list[OptionFeatureVector] = Field(default_factory=list)
    reliability_reports: list[FutureReliabilityReport] = Field(default_factory=list)
    candidates: list[FeatureCandidate] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    clarify_questions: list[ScoringClarifyQuestion] = Field(default_factory=list)
    comparative_questions: list[ScoringClarifyQuestion] = Field(default_factory=list)
    grounded_feature_coverage: float = Field(ge=0.0, le=1.0, default=0.0)
    cross_option_discrimination: float = Field(ge=0.0, le=1.0, default=0.0)
    needs_scoring_clarification: bool = False
    tag_quality_reports: list[TagQualityReport] = Field(default_factory=list)
    voi_question_order: list[str] = Field(default_factory=list)
    alignment_report: AlignmentReport | None = None
