"""Rewrite vague decision prompts into clearer questions (optional LLM)."""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, Field

from foresight_x.schemas import UserProfile
from foresight_x.structured_predict import structured_predict


class StructuredPredictLLM(Protocol):
    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        ...


class EnhancedDecisionText(BaseModel):
    """Structured output for query clarification."""

    enhanced_question: str = Field(
        description=(
            "Single clear decision question the agent should use: include constraints, "
            "stakes, and timeframe if inferable. Keep the user's intent and domain."
        )
    )


def prepare_decision_text(
    raw: str,
    llm: StructuredPredictLLM | None,
    *,
    profile: UserProfile | None = None,
    original_override: str | None = None,
) -> tuple[str, str]:
    """Return (original_text_for_trace, text_used_for_pipeline).

    ``original_override`` is the user's verbatim message when ``raw`` includes appended clarification.
    """
    original = (original_override if original_override is not None else raw).strip()
    if not raw.strip() or llm is None:
        return original, raw.strip() or original
    prof = ""
    if profile:
        bits: list[str] = []
        if profile.priorities:
            bits.append("Known priorities (from profile): " + "; ".join(profile.priorities[:12]))
        if profile.constraints:
            bits.append("Known constraints (from profile): " + "; ".join(profile.constraints[:12]))
        if bits:
            prof = "\n".join(bits) + "\n\n"
    body = raw.strip()
    prompt = (
        "The user is asking for help with a personal or professional decision. "
        "Their message may be vague, emotional, or underspecified.\n\n"
        f"{prof}"
        "USER MESSAGE:\n---\n"
        f"{body}\n"
        "---\n\n"
        "Rewrite it as ONE concrete decision question that an agent can analyze. "
        "You may restate implied stakes, reversibility, or timeframe only when they are clearly implied by the message or by the profile snippet above. "
        "CRITICAL: Do NOT invent budgets, style preferences, risk tolerance, deadlines, or priorities that the user did not state and that are not in the profile. "
        "If a dimension is unknown, omit it rather than guessing. "
        "Do not moralize. If the message is already clear, return it lightly polished without adding assumptions."
    )
    try:
        out = structured_predict(llm, EnhancedDecisionText, prompt)
        if isinstance(out, EnhancedDecisionText):
            text = out.enhanced_question.strip()
        else:
            text = EnhancedDecisionText.model_validate(out).enhanced_question.strip()
        return original, text if text else body
    except Exception:
        return original, body
