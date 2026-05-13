"""Prompt builder for final recommendation."""

from __future__ import annotations

from foresight_x.prompts.faithful_decision import ANALYTICAL_FAITHFULNESS
from foresight_x.prompts.profile_instructions import PROFILE_MUST_CONSIDER
from foresight_x.schemas import EvidenceBundle, MemoryBundle, Option, OptionEvaluation, UserState


def recommender_prompt(
    chosen_option: Option,
    evaluations: list[OptionEvaluation],
    options: list[Option],
    evidence: EvidenceBundle,
    memory: MemoryBundle,
    composite_by_option_id: dict[str, float],
    user_state: UserState,
    user_profile_json: str,
    *,
    anchor_now_iso: str,
) -> str:
    return (
        "You are the Recommender of Foresight-X.\n"
        + PROFILE_MUST_CONSIDER
        + ANALYTICAL_FAITHFULNESS
        + "Objective: justify the chosen option and list concrete next actions.\n"
        "Constraints:\n"
        "- reasoning must reference memory patterns, evidence, and simulation scores at a high level.\n"
        "- if MemoryBundle.graph_influence is present, include a brief 'why this memory surfaced' explanation "
        "using top node labels and influence scores.\n"
        "- next_actions must be an execution-ready plan of 2-4 steps max, ordered by what the user should do first.\n"
        "- each next_action must be a concrete, user-controlled task that can fit in one sitting; include the deliverable "
        "(draft, shortlist, message, checklist, application, comparison table, etc.).\n"
        "- avoid vague actions like 'research more', 'think about it', or 'network' unless the action names the target "
        "source/person/list and the expected output.\n"
        "- deadlines are optional; omit them when no date or time cue is grounded in the user's context.\n"
        "- do not turn every suggestion into a calendar block; calendar scheduling is a later execution surface.\n"
        "- reassessment_triggers are observable events that should prompt a re-run.\n"
        "- Do not invent facts outside EvidenceBundle.\n"
        "- next_actions must follow from the chosen option and evidence—not generic therapy referrals unless "
        "mental health care was part of the decision domain.\n\n"
        f"CURRENT_TIME_ANCHOR (ISO-8601 UTC from the user's session or server): {anchor_now_iso}\n\n"
        f"UserState: {user_state.model_dump_json()}\n"
        f"Chosen option (pre-selected by composite score): {chosen_option.model_dump_json()}\n"
        f"Composite scores by option_id: {composite_by_option_id}\n"
        f"All OptionEvaluation: {[e.model_dump() for e in evaluations]}\n"
        f"Options: {[o.model_dump() for o in options]}\n"
        f"MemoryBundle: {memory.model_dump_json()}\n"
        f"EvidenceBundle: {evidence.model_dump_json()}\n"
        f"user_profile: {user_profile_json}\n"
    )
