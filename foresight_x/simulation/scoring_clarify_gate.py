"""Pre-recommendation scoring clarification gate (MAVT grounded-coverage / VoI).

Industrial practice: do not emit a final recommendation until critical tradeoff
features are grounded above ``COVERAGE_CLARIFY_THRESHOLD``, unless the user
explicitly opts into a provisional ranking (skip) or has completed one clarify round.
"""

from __future__ import annotations

from foresight_x.simulation.feature_schemas import FeatureAuditBundle
from foresight_x.simulation.missing_field_detector import COVERAGE_CLARIFY_THRESHOLD

# Maximum targeted questions shown at the pre-recommendation gate (VoI-ranked).
MAX_GATE_QUESTIONS = 3


def scoring_clarification_attempted(
    resume_from_stage: str | None,
    scoring_clarification: dict[str, str] | None,
    scoring_clarification_skip: bool,
) -> bool:
    """True when this run is resuming after a scoring-clarify pause or explicit skip."""
    if not resume_from_stage:
        return False
    stage = resume_from_stage.strip().lower()
    if stage not in ("evaluate", "finalize"):
        return False
    return bool(scoring_clarification) or scoring_clarification_skip


def should_pause_pipeline_for_scoring_clarify(
    audit: FeatureAuditBundle | None,
    *,
    clarification_attempted: bool,
    allow_provisional: bool,
) -> bool:
    """Hard gate: pause before finalize when coverage is insufficient and user has not responded."""
    if allow_provisional:
        return False
    if audit is None or not audit.needs_scoring_clarification:
        return False
    if clarification_attempted:
        return False
    return True


def recommendation_is_provisional(
    audit: FeatureAuditBundle | None,
    *,
    allow_provisional: bool,
    clarification_attempted: bool,
) -> bool:
    """Mark trace when the emitted recommendation used insufficiently grounded features."""
    if audit is None or not audit.needs_scoring_clarification:
        return False
    if allow_provisional:
        return True
    if clarification_attempted:
        return True
    # Non-stream fallback: finalized without a pre-score clarify round.
    return True


__all__ = [
    "COVERAGE_CLARIFY_THRESHOLD",
    "MAX_GATE_QUESTIONS",
    "recommendation_is_provisional",
    "scoring_clarification_attempted",
    "should_pause_pipeline_for_scoring_clarify",
]
