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
            "Exactly ONE decision question string for downstream analysis. "
            "Must preserve every substantive detail from the user (stakes, options, domain terms, numbers, names). "
            "Do not refuse, sanitize topics, or replace the user's framing with a 'safer' generic question."
        )
    )


# If the model returns safety refusals or an over-short rewrite, we keep the user's text.
_REFUSAL_HINTS: tuple[str, ...] = (
    "i can't assist",
    "i cannot assist",
    "can't help with",
    "cannot help with",
    "i'm not able to",
    "i am not able to",
    "unable to comply",
    "as an ai language model",
    "as a language model",
    "i don't have the ability",
    "cannot provide guidance",
    "i cannot provide",
    "refuse to",
    "inappropriate content",
    "harmful content",
    "抱歉",
    "无法提供",
    "不能协助",
    "无法协助",
)


def _looks_like_refusal(text: str) -> bool:
    t = text.lower()
    return any(h in t for h in _REFUSAL_HINTS)


def _likely_stripped_too_much(body: str, enhanced: str) -> bool:
    """Heuristic: long detailed message vs very short rewrite — probably over-sanitized."""
    if len(body) < 160:
        return False
    e = enhanced.strip()
    if len(e) >= len(body) * 0.45:
        return False
    return len(e) < 100 and len(body) > 280


def _pick_enhanced_or_raw(body: str, enhanced: str) -> str:
    e = (enhanced or "").strip()
    if not e:
        return body
    if _looks_like_refusal(e):
        return body
    if _likely_stripped_too_much(body, e):
        return body
    return e


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
        if profile.stated_priority_lines():
            bits.append(
                "User-stated priorities (authoritative): " + "; ".join(profile.stated_priority_lines()[:12])
            )
        if profile.inferred_priorities:
            bits.append(
                "System-inferred priorities (may be revised): "
                + "; ".join(profile.inferred_priorities[:12])
            )
        if profile.constraints:
            bits.append("Known constraints (from profile): " + "; ".join(profile.constraints[:12]))
        if bits:
            prof = "\n".join(bits) + "\n\n"
    body = raw.strip()
    prompt = (
        "You are a technical editor for a private decision-support tool (Foresight-X).\n"
        "Your ONLY job: turn the user's text into ONE clear, analyzable decision question.\n\n"
        "RULES (strict):\n"
        "- PRESERVE the user's substance: keep their domain, options, tensions, numbers, names, and any sensitive or "
        "stigmatized topic if it is central to the decision. Do NOT sanitize, soften, moralize, or replace their "
        "stakes with generic 'responsible' wording.\n"
        "- Do NOT delete material content. If the message is long, you may tighten phrasing but must not drop "
        "constraints or options the user named.\n"
        "- Do NOT refuse, hedge with ethics lectures, or output disclaimers — output ONLY the single reformulated "
        "question string (no preamble, no bullet list).\n"
        "- Legally or socially sensitive domains can still be legitimate decision contexts; treat them like any other "
        "trade-off analysis subject.\n"
        "- You may clarify vague grammar and structure. You may restate implied stakes or timeframe ONLY when clearly "
        "implied by the user text or profile below.\n"
        "- Do NOT invent budgets, deadlines, preferences, or priorities not present in the message or profile.\n"
        "- If the message is already one clear question, change at most light copy-editing (typos, punctuation).\n\n"
        f"{prof}"
        "USER MESSAGE:\n---\n"
        f"{body}\n"
        "---\n\n"
        "Return JSON matching the schema: one field `enhanced_question` with ONLY the final question text."
    )
    try:
        out = structured_predict(llm, EnhancedDecisionText, prompt)
        if isinstance(out, EnhancedDecisionText):
            text = out.enhanced_question.strip()
        else:
            text = EnhancedDecisionText.model_validate(out).enhanced_question.strip()
        final_text = _pick_enhanced_or_raw(body, text)
        return original, final_text
    except Exception:
        return original, body
