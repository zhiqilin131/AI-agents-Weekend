"""Outcome capture helpers for the Harness."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import DecisionOutcome

if TYPE_CHECKING:
    from foresight_x.retrieval.memory import UserMemory


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_bool(text: str) -> bool:
    t = text.strip().lower()
    if t in {"y", "yes", "true", "1"}:
        return True
    if t in {"n", "no", "false", "0"}:
        return False
    raise ValueError(f"Expected yes/no, got: {text!r}")


def save_decision_outcome(
    outcome: DecisionOutcome,
    *,
    settings: Settings | None = None,
    outcomes_dir: Path | None = None,
) -> Path:
    """Persist outcome to ``data/outcomes/{decision_id}.json``."""
    s = settings or load_settings()
    root = outcomes_dir if outcomes_dir is not None else s.outcomes_dir
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{outcome.decision_id}.json"
    path.write_text(outcome.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_decision_outcome(
    decision_id: str,
    *,
    settings: Settings | None = None,
    outcomes_dir: Path | None = None,
) -> DecisionOutcome:
    s = settings or load_settings()
    root = outcomes_dir if outcomes_dir is not None else s.outcomes_dir
    path = root / f"{decision_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Decision outcome not found: {path}")
    return DecisionOutcome.model_validate_json(path.read_text(encoding="utf-8"))


def load_decision_outcome_optional(
    decision_id: str,
    *,
    settings: Settings | None = None,
    outcomes_dir: Path | None = None,
) -> DecisionOutcome | None:
    """Return persisted outcome if present and valid, else ``None``."""
    s = settings or load_settings()
    root = outcomes_dir if outcomes_dir is not None else s.outcomes_dir
    path = root / f"{decision_id}.json"
    if not path.is_file():
        return None
    try:
        return DecisionOutcome.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def ask_outcome(
    decision_id: str,
    *,
    settings: Settings | None = None,
    input_fn: Callable[[str], str] = input,
    user_memory: "UserMemory | None" = None,
    apply_improvement: bool = True,
) -> DecisionOutcome:
    """Interactive CLI-style outcome capture and optional memory write-back."""
    s = settings or load_settings()
    took_action = _parse_bool(input_fn("Did you take the recommended action? [y/n]: "))
    actual = input_fn("What actually happened? ").strip()
    quality_raw = input_fn("Outcome quality (1-5): ").strip()
    reversed_later = _parse_bool(input_fn("Did you reverse this later? [y/n]: "))
    quality = int(quality_raw)
    outcome = DecisionOutcome(
        decision_id=decision_id,
        user_took_recommended_action=took_action,
        actual_outcome=actual,
        user_reported_quality=quality,
        reversed_later=reversed_later,
        timestamp=_utc_now(),
    )
    save_decision_outcome(outcome, settings=s)
    if apply_improvement:
        from foresight_x.harness.improvement_loop import apply_outcome_to_memory

        apply_outcome_to_memory(
            decision_id,
            outcome,
            settings=s,
            user_memory=user_memory,
        )
    return outcome
