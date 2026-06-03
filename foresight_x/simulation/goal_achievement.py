"""Structured goal–option fit (G1) with lexical fallback as candidate only."""

from __future__ import annotations

import re
from dataclasses import dataclass

from foresight_x.schemas import UserState
from foresight_x.simulation.feature_schemas import FeatureLevel, FeatureStatus

_STOP = {"the", "and", "for", "with", "that", "this", "from", "your", "have", "into", "work"}

# Goal themes → feature requirements / penalties (deterministic achievement function).
_GOAL_THEMES: list[dict] = [
    {
        "id": "financial_stability",
        "goal_keywords": ("financial", "income", "money", "salary", "stipend", "afford", "debt"),
        "penalize_high": ("money_cost_level", "downside_severity_level"),
        "reward_high": (),
        "require_medium": (),
    },
    {
        "id": "career_growth",
        "goal_keywords": ("career", "growth", "promotion", "advance", "upskill", "learning"),
        "penalize_high": ("time_cost_level",),
        "reward_high": ("upside_potential_level",),
        "require_medium": ("upside_potential_level",),
    },
    {
        "id": "mental_health",
        "goal_keywords": ("mental", "health", "burnout", "sleep", "rest", "wellbeing", "well-being", "calm"),
        "penalize_high": ("stress_load_level", "workload_level"),
        "reward_high": (),
        "require_medium": (),
    },
    {
        "id": "work_life_balance",
        "goal_keywords": ("balance", "flexible", "flexibility", "family", "life"),
        "penalize_high": ("workload_level", "time_cost_level", "stress_load_level"),
        "reward_high": (),
        "require_medium": (),
    },
    {
        "id": "quality_work",
        "goal_keywords": ("quality", "excellence", "craft", "thesis", "deliverable"),
        "penalize_high": ("time_cost_level",),
        "reward_high": ("upside_potential_level",),
        "require_medium": (),
    },
]


@dataclass
class GoalAchievementResult:
    level: FeatureLevel
    status: FeatureStatus
    matched_themes: list[str]
    note: str


def _level_rank(lv: FeatureLevel) -> int:
    return {"low": 0, "medium": 1, "high": 2, "unknown": 1}.get(lv, 1)


def _goal_texts(user_state: UserState) -> list[str]:
    texts: list[str] = list(user_state.goals or [])
    texts.extend(user_state.profile_values or [])
    texts.extend(user_state.profile_priorities or [])
    return [t.strip() for t in texts if t.strip()]


def _themes_for_goals(goal_texts: list[str]) -> list[dict]:
    matched: list[dict] = []
    blob = " ".join(goal_texts).lower()
    for theme in _GOAL_THEMES:
        if any(kw in blob for kw in theme["goal_keywords"]):
            matched.append(theme)
    return matched


def _achievement_score(
    theme: dict,
    features: dict[str, FeatureLevel],
) -> float:
    """Higher = better fit for this goal theme given resolved feature levels."""
    score = 0.5
    for key in theme["penalize_high"]:
        lv = features.get(key, "unknown")
        if lv == "high":
            score -= 0.35
        elif lv == "medium":
            score -= 0.12
        elif lv == "low":
            score += 0.08
    for key in theme["reward_high"]:
        lv = features.get(key, "unknown")
        if lv == "high":
            score += 0.30
        elif lv == "medium":
            score += 0.12
        elif lv == "low":
            score -= 0.15
    for key in theme["require_medium"]:
        lv = features.get(key, "unknown")
        if _level_rank(lv) >= 1:
            score += 0.10
        elif lv == "low":
            score -= 0.20
    return max(0.0, min(1.0, score))


def _score_to_level(score: float) -> FeatureLevel:
    if score >= 0.72:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


def _lexical_overlap_level(option_blob: str, goal_texts: list[str]) -> FeatureLevel | None:
    if not goal_texts:
        return None
    goal_words: set[str] = set()
    for g in goal_texts:
        goal_words.update(w for w in re.findall(r"[a-zA-Z]{3,}", g.lower()) if w not in _STOP)
    if not goal_words:
        return None
    opt_words = {w for w in re.findall(r"[a-zA-Z]{3,}", option_blob.lower()) if w not in _STOP}
    overlap = len(goal_words & opt_words) / len(goal_words)
    if overlap >= 0.35:
        return "high"
    if overlap >= 0.12:
        return "medium"
    if overlap > 0:
        return "low"
    return None


def assess_structured_goal_alignment(
    option_blob: str,
    user_state: UserState,
    features: dict[str, FeatureLevel],
) -> GoalAchievementResult | None:
    """G1 structured achievement; returns None if no goals to assess."""
    goal_texts = _goal_texts(user_state)
    if not goal_texts:
        return None

    themes = _themes_for_goals(goal_texts)
    if themes:
        scores = [_achievement_score(t, features) for t in themes]
        avg = sum(scores) / len(scores)
        level = _score_to_level(avg)
        theme_ids = [str(t["id"]) for t in themes]
        return GoalAchievementResult(
            level=level,
            status="known",
            matched_themes=theme_ids,
            note=f"Structured goal achievement over themes: {', '.join(theme_ids)}.",
        )

    overlap = _lexical_overlap_level(option_blob, goal_texts)
    if overlap is not None:
        return GoalAchievementResult(
            level=overlap,
            status="candidate",
            matched_themes=["lexical_overlap"],
            note="Lexical goal overlap only; treat as candidate until confirmed.",
        )
    return None
