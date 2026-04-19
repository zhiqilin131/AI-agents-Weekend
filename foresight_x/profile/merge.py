"""Merge persisted profile into ``UserState`` for retrieval and prompts."""

from __future__ import annotations

from foresight_x.schemas import UserProfile, UserState


def append_clarification_to_profile(profile: UserProfile, answers: dict[str, str]) -> UserProfile:
    """Persist structured clarification choices as short user-owned priority lines (deduped)."""
    if not answers:
        return profile
    new_priorities = list(profile.stated_priority_lines())
    seen = {p.strip().lower() for p in new_priorities if p.strip()}
    for qid, label in answers.items():
        q = str(qid).strip().replace("_", " ")
        line = f"{q}: {str(label).strip()}"
        key = line.lower()
        if key not in seen:
            new_priorities.append(line)
            seen.add(key)
    return profile.model_copy(update={"user_priorities": new_priorities, "priorities": new_priorities})


def append_inferred_priority_line(
    profile: UserProfile,
    line: str,
    *,
    max_lines: int = 48,
) -> UserProfile:
    """Append one system-inferred line (e.g. from shadow chat); dedupe case-insensitively."""
    text = (line or "").strip()
    if not text:
        return profile
    inf = list(profile.inferred_priorities)
    seen = {x.strip().lower() for x in inf if x.strip()}
    key = text.lower()
    if key in seen:
        return profile
    inf.append(text)
    if len(inf) > max_lines:
        inf = inf[-max_lines:]
    return profile.model_copy(update={"inferred_priorities": inf})


def merge_profile_into_user_state(user_state: UserState, profile: UserProfile) -> UserState:
    stated = profile.stated_priority_lines()
    inferred = list(profile.inferred_priorities)
    combined = list(dict.fromkeys([*stated, *inferred]))
    merged_goals = list(dict.fromkeys([*stated, *inferred, *user_state.goals]))
    return user_state.model_copy(
        update={
            "goals": merged_goals,
            "profile_user_priorities": stated,
            "profile_inferred_priorities": inferred,
            "profile_priorities": combined,
            "profile_about_me": profile.about_me,
            "profile_constraints": list(profile.constraints),
            "profile_values": list(profile.values),
        }
    )
