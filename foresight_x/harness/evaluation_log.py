"""Append-only log for offline policy learning (e.g. contextual bandits) — CPU-friendly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from foresight_x.config import Settings, load_settings
from foresight_x.schemas import DecisionCommit, DecisionOutcome, DecisionTrace


def _composite_from_eval(
    trace: DecisionTrace,
    option_id: str,
) -> float | None:
    """Match ``recommender.composite_score`` weights for the chosen arm."""
    weights = {
        "expected_value_score": 0.25,
        "risk_score": -0.15,
        "regret_score": -0.15,
        "uncertainty_score": -0.15,
        "goal_alignment_score": 0.25,
    }
    for ev in trace.evaluations:
        if ev.option_id == option_id:
            total = 0.0
            for k, w in weights.items():
                total += w * float(getattr(ev, k))
            return total
    return None


def build_evaluation_record(
    trace: DecisionTrace,
    outcome: DecisionOutcome,
    *,
    commit: DecisionCommit | None = None,
) -> dict[str, Any]:
    """Structured row for JSONL (no raw user text — features only)."""
    us = trace.user_state
    rec_id = trace.recommendation.chosen_option_id
    arm = (commit.chosen_option_id if commit else None) or rec_id
    reward = max(0.0, min(1.0, outcome.user_reported_quality / 5.0))
    composite_chosen = _composite_from_eval(trace, arm) if arm else None

    features: dict[str, Any] = {
        "decision_type": us.decision_type,
        "time_pressure": us.time_pressure.value,
        "stress_level": us.stress_level,
        "workload": us.workload,
        "reversibility": us.reversibility.value,
        "recommendation_option_id": rec_id,
        "chosen_option_id": arm,
        "chosen_same_as_recommend_id": bool(rec_id and arm and rec_id == arm),
        "user_reported_followed_recommendation": outcome.user_took_recommended_action,
        "explicit_commit_matches_rec": commit.matches_recommendation if commit else None,
    }
    if composite_chosen is not None:
        features["composite_score_at_commit"] = round(composite_chosen, 4)

    row: dict[str, Any] = {
        "schema_version": 1,
        "decision_id": outcome.decision_id,
        "timestamp": outcome.timestamp,
        "reward": round(reward, 4),
        "user_took_recommended_action": outcome.user_took_recommended_action,
        "reversed_later": outcome.reversed_later,
        "had_explicit_commit": commit is not None,
        "features": features,
    }
    if commit:
        row["commit"] = {
            "chosen_option_id": commit.chosen_option_id,
            "matches_recommendation": commit.matches_recommendation,
            "committed_at": commit.committed_at,
        }
    return row


def append_evaluation_log(
    row: dict[str, Any],
    *,
    settings: Settings | None = None,
    logs_dir: Path | None = None,
    filename: str = "decisions.jsonl",
) -> Path:
    s = settings or load_settings()
    root = logs_dir if logs_dir is not None else s.evaluation_logs_dir
    root.mkdir(parents=True, exist_ok=True)
    path = root / filename
    line = json.dumps(row, ensure_ascii=False, default=str) + "\n"
    with path.open("a", encoding="utf-8") as f:
        f.write(line)
    return path
