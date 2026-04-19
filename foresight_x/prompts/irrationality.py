"""Prompt builder for irrationality detection."""

from __future__ import annotations

from foresight_x.prompts.profile_instructions import PROFILE_MUST_CONSIDER
from foresight_x.schemas import MemoryBundle, UserState


def irrationality_prompt(
    user_state: UserState,
    memory: MemoryBundle,
    rule_flags: list[str],
) -> str:
    return (
        "You are the Irrationality Detector of Foresight-X.\n"
        + PROFILE_MUST_CONSIDER
        + "Objective: produce a RationalityReport from the current user state and memory.\n"
        "Output constraints:\n"
        "- detected_biases should be short labels.\n"
        "- confidence must be between 0 and 1.\n"
        "- recommended_slowdowns must be actionable.\n"
        "- Do not invent facts not present in input.\n\n"
        f"Rule flags: {rule_flags}\n"
        f"UserState: {user_state.model_dump_json()}\n"
        f"MemoryBundle: {memory.model_dump_json()}\n"
    )
