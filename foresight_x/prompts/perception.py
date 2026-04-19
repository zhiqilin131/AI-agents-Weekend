"""Prompt builder for Perception -> UserState extraction."""

from __future__ import annotations

from foresight_x.schemas import UserProfile


def _profile_nonempty(profile: UserProfile) -> bool:
    return bool(
        profile.stated_priority_lines()
        or profile.inferred_priorities
        or profile.about_me.strip()
        or profile.constraints
        or profile.values
    )


def perception_prompt(raw_input: str, profile: UserProfile | None = None) -> str:
    profile_block = ""
    if profile is not None and _profile_nonempty(profile):
        profile_block = (
            "\nUser profile (shadow self) — you MUST reflect this in goals, framing, and decision_type:\n"
            f"{profile.model_dump_json(indent=2)}\n"
        )
    return (
        "You are the Perception module of Foresight-X.\n"
        "Objective: convert the user's free-form decision text into a UserState JSON object.\n"
        "Constraints:\n"
        "- The `goals` field must reflect what the user actually wants to decide or optimize—including "
        "sensitive or stigmatized objectives if explicitly stated—NOT sanitized substitutes like "
        "\"seek professional help\" unless they asked for that.\n"
        "- Infer stress_level and workload from language cues if not explicit.\n"
        "- Keep goals concrete and user-centric.\n"
        "- Use one of: time_pressure={low,medium,high}.\n"
        "- Use one of: reversibility={reversible,partial,irreversible}.\n"
        f"{profile_block}"
        "User input:\n"
        f"{raw_input.strip()}\n"
    )
