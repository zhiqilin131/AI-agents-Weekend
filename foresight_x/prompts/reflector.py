"""Prompt builder for post-hoc reflection on a full decision trace."""

from __future__ import annotations

from foresight_x.prompts.faithful_decision import ANALYTICAL_FAITHFULNESS
from foresight_x.prompts.profile_instructions import PROFILE_MUST_CONSIDER
from foresight_x.schemas import DecisionTrace


def reflector_prompt(trace: DecisionTrace) -> str:
    return (
        "You are the Reflector of Foresight-X.\n"
        + PROFILE_MUST_CONSIDER
        + ANALYTICAL_FAITHFULNESS
        + "Objective: critique this decision trace and surface failure modes for the Harness.\n"
        "Output a Reflection with:\n"
        "- possible_errors: where the reasoning may be wrong.\n"
        "- uncertainty_sources: what drove score uncertainty.\n"
        "- model_limitations: what the model cannot know.\n"
        "- information_gaps: missing data the user should seek.\n"
        "- self_improvement_signal: one sentence for memory/prompt tuning.\n"
        "- Do not use possible_errors or information_gaps primarily to push psychotherapy unless clinically on-topic.\n\n"
        f"DecisionTrace: {trace.model_dump_json()}\n"
    )
