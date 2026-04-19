"""Merge persisted profile into ``UserState`` for retrieval and prompts."""

from __future__ import annotations

from foresight_x.schemas import UserProfile, UserState


def append_clarification_to_profile(profile: UserProfile, answers: dict[str, str]) -> UserProfile:
    """Persist structured clarification choices as short priority lines (deduped)."""
    if not answers:
        return profile
    new_priorities = list(profile.priorities)
    seen = {p.strip().lower() for p in new_priorities if p.strip()}
    for qid, label in answers.items():
        q = str(qid).strip().replace("_", " ")
        line = f"{q}: {str(label).strip()}"
        key = line.lower()
        if key not in seen:
            new_priorities.append(line)
            seen.add(key)
    return profile.model_copy(update={"priorities": new_priorities})


def merge_profile_into_user_state(user_state: UserState, profile: UserProfile) -> UserState:
    merged_goals = list(dict.fromkeys([*profile.priorities, *user_state.goals]))
    return user_state.model_copy(
        update={
            "goals": merged_goals,
            "profile_priorities": list(profile.priorities),
            "profile_about_me": profile.about_me,
            "profile_constraints": list(profile.constraints),
            "profile_values": list(profile.values),
        }
    )
