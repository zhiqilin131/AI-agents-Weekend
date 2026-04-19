"""Extra query text from user profile fields for vector retrieval."""

from __future__ import annotations

from foresight_x.schemas import UserState


def profile_snippet_for_retrieval(user_state: UserState) -> str:
    parts: list[str] = []
    if user_state.profile_priorities:
        parts.append("priorities " + " ".join(user_state.profile_priorities))
    if user_state.profile_about_me.strip():
        parts.append("about_me " + user_state.profile_about_me.strip()[:2000])
    if user_state.profile_constraints:
        parts.append("constraints " + " ".join(user_state.profile_constraints))
    if user_state.profile_values:
        parts.append("values " + " ".join(user_state.profile_values))
    return " ".join(parts)
