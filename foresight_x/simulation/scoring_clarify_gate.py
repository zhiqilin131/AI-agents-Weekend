"""Pre-recommendation scoring clarification gate (MAVT grounded-coverage / VoI).

Industrial practice: pause before finalize when critical tradeoff features are
insufficiently grounded or options are indistinguishable. Supports multi-round
elicitation up to ``MAX_ELICITATION_ROUNDS`` before forcing provisional finalize.
"""

from __future__ import annotations

from foresight_x.simulation.feature_schemas import FeatureAuditBundle
from foresight_x.simulation.missing_field_detector import COVERAGE_CLARIFY_THRESHOLD

MAX_GATE_QUESTIONS = 3
MAX_ELICITATION_ROUNDS = 3


def scoring_clarification_attempted(
    resume_from_stage: str | None,
    scoring_clarification: dict[str, str] | None,
    scoring_clarification_skip: bool,
    *,
    comparative_answers: dict[str, list[str]] | None = None,
) -> bool:
    """True when this run is resuming after a scoring-clarify pause or explicit skip."""
    if not resume_from_stage:
        return False
    stage = resume_from_stage.strip().lower()
    if stage not in ("evaluate", "finalize"):
        return False
    return bool(scoring_clarification) or bool(comparative_answers) or scoring_clarification_skip


def elicitation_round_count(rounds: list | None) -> int:
    return len(rounds or [])


def has_elicitation_questions(audit: FeatureAuditBundle | None) -> bool:
    if audit is None:
        return False
    return bool(audit.clarify_questions or audit.comparative_questions)


def should_pause_pipeline_for_scoring_clarify(
    audit: FeatureAuditBundle | None,
    *,
    allow_provisional: bool,
    scoring_clarification_skip: bool = False,
    elicitation_rounds: int = 0,
) -> bool:
    """Hard gate: pause before finalize when coverage/discrimination insufficient."""
    if allow_provisional or scoring_clarification_skip:
        return False
    if audit is None or not audit.needs_scoring_clarification:
        return False
    if elicitation_rounds >= MAX_ELICITATION_ROUNDS:
        return False
    if not has_elicitation_questions(audit):
        return False
    return True


def recommendation_is_provisional(
    audit: FeatureAuditBundle | None,
    *,
    allow_provisional: bool,
    clarification_attempted: bool,
    elicitation_rounds: int = 0,
) -> bool:
    """Mark trace when the emitted recommendation used insufficiently grounded features."""
    if audit is None or not audit.needs_scoring_clarification:
        return False
    if allow_provisional:
        return True
    if clarification_attempted:
        return True
    if elicitation_rounds >= MAX_ELICITATION_ROUNDS:
        return True
    return True


__all__ = [
    "COVERAGE_CLARIFY_THRESHOLD",
    "MAX_ELICITATION_ROUNDS",
    "MAX_GATE_QUESTIONS",
    "elicitation_round_count",
    "has_elicitation_questions",
    "recommendation_is_provisional",
    "scoring_clarification_attempted",
    "should_pause_pipeline_for_scoring_clarify",
]
