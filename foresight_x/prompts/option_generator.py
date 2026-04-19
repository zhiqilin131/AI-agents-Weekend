"""Prompt builder for option generation."""

from __future__ import annotations

from foresight_x.prompts.profile_instructions import PROFILE_MUST_CONSIDER
from foresight_x.schemas import EvidenceBundle, MemoryBundle, UserState


def option_generator_prompt(
    user_state: UserState,
    memory: MemoryBundle,
    evidence: EvidenceBundle,
) -> str:
    return (
        "You are the Option Generator of Foresight-X.\n"
        + PROFILE_MUST_CONSIDER
        + "Objective: propose 2-4 distinct options for the user's decision.\n"
        "Constraints:\n"
        "- At least one option should expand beyond explicit user wording.\n"
        "- Options must be mutually distinct, not paraphrases.\n"
        "- cost_of_reversal must be one of {low, medium, high}.\n"
        "- Keep options actionable, concise, and realistic.\n"
        "- Avoid generic labels such as 'seek support', 'wait and see', 'think more'.\n"
        "- Each option description must include ONE concrete first action (who/where/how) "
        "and a practical near-term horizon (e.g. today/24h/this week).\n"
        "- Each option must anchor to the user's actual context (raw_input/goals/evidence), "
        "not template filler.\n\n"
        f"UserState: {user_state.model_dump_json()}\n"
        f"MemoryBundle: {memory.model_dump_json()}\n"
        f"EvidenceBundle: {evidence.model_dump_json()}\n"
    )
