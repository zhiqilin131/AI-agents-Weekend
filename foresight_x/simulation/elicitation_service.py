"""Merge comparative + level clarify answers into the scoring pipeline."""

from __future__ import annotations

from datetime import datetime, timezone

from foresight_x.schemas import Option
from foresight_x.simulation.answer_validator import validate_comparative_answers, validate_scoring_clarification
from foresight_x.simulation.comparative_elicitation import comparative_to_scoring_clarification
from foresight_x.simulation.feature_schemas import ElicitationRound


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def merge_elicitation_answers(
    *,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    existing_clarification: dict[str, str] | None = None,
    option_ids: set[str] | None = None,
) -> tuple[dict[str, str], dict[str, list[str]], list[str]]:
    """Return merged level answers, validated comparative answers, and validation errors."""
    errors: list[str] = []
    valid_levels, level_errors = validate_scoring_clarification(scoring_clarification)
    errors.extend(level_errors)

    valid_cmp, cmp_errors = validate_comparative_answers(comparative_answers, expected_option_ids=option_ids)
    errors.extend(cmp_errors)

    merged = dict(existing_clarification or {})
    cmp_levels = comparative_to_scoring_clarification(valid_cmp)
    merged.update(cmp_levels)
    merged.update(valid_levels)
    return merged, valid_cmp, errors


def record_elicitation_round(
    rounds: list[dict] | None,
    *,
    comparative_answers: dict[str, list[str]],
    scoring_clarification: dict[str, str],
    coverage_before: float,
    coverage_after: float,
    discrimination_after: float,
    source: str = "gate",
) -> list[dict]:
    history = list(rounds or [])
    history.append(
        ElicitationRound(
            round_id=f"elr-{_utc_now_iso()}",
            timestamp=_utc_now_iso(),
            comparative_answers=comparative_answers,
            scoring_clarification=scoring_clarification,
            coverage_before=round(coverage_before, 3),
            coverage_after=round(coverage_after, 3),
            discrimination_after=round(discrimination_after, 3),
            source=source,  # type: ignore[arg-type]
        ).model_dump(mode="json")
    )
    return history


def option_ids_from_options(options: list[Option]) -> set[str]:
    return {o.option_id for o in options}
