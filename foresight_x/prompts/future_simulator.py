"""Prompt builder for multi-future simulation."""

from __future__ import annotations

from foresight_x.prompts.faithful_decision import ANALYTICAL_FAITHFULNESS
from foresight_x.prompts.profile_instructions import PROFILE_MUST_CONSIDER
from foresight_x.schemas import EvidenceBundle, MemoryBundle, Option, UserState


def future_simulator_prompt(
    option: Option,
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
) -> str:
    mem_block = ""
    if memory and (
        memory.behavioral_patterns
        or memory.similar_past_decisions
        or (memory.prior_outcomes_summary or "").strip()
    ):
        mem_block = (
            "User-specific memory (from similar past DECISIONS in our vector store — not new facts about the world):\n"
            f"{memory.model_dump_json()}\n"
            "Use this only to check consistency (e.g. recurring biases, past choices). "
            "Do not treat memory text as authoritative external statistics.\n\n"
        )

    return (
        "You are the Future Simulator of Foresight-X.\n"
        + PROFILE_MUST_CONSIDER
        + ANALYTICAL_FAITHFULNESS
        + mem_block
        + "Objective: for the given option, describe best / base / worst plausible futures over ONE concrete time horizon.\n"
        "Calibration:\n"
        "- Assign probabilities that reflect uncertainty honestly: if evidence is thin, avoid extreme 0.9/0.05/0.05 splits "
        "unless UserState or EvidenceBundle strongly supports them.\n"
        "- In the base scenario, state the main uncertainty explicitly (what could swing the outcome).\n"
        "- Trajectories must be causal (what happens step-by-step), not generic encouragement.\n"
        "Constraints:\n"
        "- Output a SimulatedFuture with exactly three scenarios: labels best, base, worst.\n"
        "- Probabilities must sum to 1.0 (+/- 0.05).\n"
        "- Ground narratives in EvidenceBundle (facts, base_rates, recent_events) where possible; "
        "do not invent verifiable external statistics or named studies not present in the bundle.\n"
        "- time_horizon should be concrete (e.g. '3 months', '6 months').\n"
        "- key_drivers must be short phrases tied to user goals, constraints, or evidence (not buzzwords).\n\n"
        f"Option: {option.model_dump_json()}\n"
        f"UserState: {user_state.model_dump_json()}\n"
        f"EvidenceBundle: {evidence.model_dump_json()}\n"
    )
