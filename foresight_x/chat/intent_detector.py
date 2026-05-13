from __future__ import annotations

import re

from pydantic import BaseModel, Field

from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict


class ChatIntentResult(BaseModel):
    intent: str = "normal"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    decision_type: str | None = None
    reasons: list[str] = Field(default_factory=list)
    suggested_action: str = "continue"


class _LLMIntentOut(BaseModel):
    intent: str
    confidence: float
    decision_type: str | None = None
    reasons: list[str] = Field(default_factory=list)
    suggested_action: str


_ROLEPLAY_HINTS = [
    "pretend to be",
    "act as",
    "roleplay",
    "you are now",
    "simulate",
    "扮演",
    "你现在是",
    "进入剧情",
]
_DECISION_HINTS = [
    "should i",
    "shall i",
    "what shall",
    "what should i do",
    "whether to",
    "trying to decide",
    "deciding whether",
    "help me decide",
    "which option",
    "help me choose",
    "choose for me",
    "pick for me",
    "pick one",
    "pick a number",
    "choose a number",
    "tradeoff",
    "pros and cons",
    "deadline",
    "offer",
    "risk",
    "bet on",
    "wager",
    "roulette",
    "winning number",
    "red or black",
    "black or red",
    "what do i do",
    "我该怎么办",
    "我该不该",
    "要不要",
    "帮我决定",
    "选哪个",
    "利弊",
    "风险",
]

_GAMBLING_DECISION_RE = re.compile(
    r"\b("
    r"roulette|casino|blackjack|sportsbook|bet(?:ting)?|wager|"
    r"winning\s+(?:number|pick|bet)|"
    r"(?:red|black)\s+or\s+(?:red|black)|"
    r"(?:heads|tails)\s+or\s+(?:heads|tails)|"
    r"which\s+(?:number|color|side)\s+(?:should\s+i\s+)?(?:bet|pick|choose)|"
    r"(?:pick|choose|give\s+me)\s+(?:a\s+)?(?:winning\s+)?(?:number|color|side)"
    r")\b",
    re.I,
)


def _heuristic(message: str) -> ChatIntentResult:
    text = (message or "").strip().lower()
    if not text:
        return ChatIntentResult()
    role_hits = [k for k in _ROLEPLAY_HINTS if k in text]
    dec_hits = [k for k in _DECISION_HINTS if k in text]
    conf_role = min(1.0, 0.36 + 0.2 * len(role_hits)) if role_hits else 0.0
    conf_dec = min(1.0, 0.36 + 0.16 * len(dec_hits)) if dec_hits else 0.0
    reasons: list[str] = []
    if "option a" in text and "option b" in text:
        conf_dec = max(conf_dec, 0.75)
        reasons.append("explicit A/B options")
    if _GAMBLING_DECISION_RE.search(text):
        conf_dec = max(conf_dec, 0.88)
        reasons.append("chance/gambling choice request")
    if any(k in text for k in ["internship", "job", "career", "class", "project", "finance", "关系", "实习"]):
        conf_dec = max(conf_dec, 0.62)
        reasons.append("high-stakes domain signal")
    if role_hits:
        reasons.append(f"roleplay cues: {', '.join(role_hits[:3])}")
    if dec_hits:
        reasons.append(f"decision cues: {', '.join(dec_hits[:3])}")
    # Voice/common phrasing: "whether to X ... but I'm busy with Y" is a fork without "or".
    if "whether" in text and len(text) > 24 and any(k in text for k in ("busy", "conflict", "at the same time", "but also")):
        conf_dec = min(1.0, conf_dec + 0.24)
        reasons.append("whether + competing commitment")
    # Typing "A or B" / "school or work" is a strong fork signal even when only one keyword matched.
    if " or " in text and len(text) > 12:
        conf_dec = min(1.0, conf_dec + 0.18)
        reasons.append("binary fork phrasing (or)")
    if re.search(r"\b(i need|give me|tell me|choose|pick)\b", text) and re.search(r"\b(number|red|black|side|bet)\b", text):
        conf_dec = max(conf_dec, 0.68)
        reasons.append("asks assistant to pick an outcome")
    # Clarification modal answers almost always mean the user is in a decision workflow.
    if "user clarification (structured):" in text:
        conf_dec = min(1.0, conf_dec + 0.34)
        reasons.append("structured clarification present")
    if conf_role >= 0.66 and conf_role > conf_dec:
        return ChatIntentResult(
            intent="roleplay_candidate",
            confidence=round(conf_role, 3),
            reasons=reasons,
            suggested_action="show_role_mode_prompt",
        )
    if conf_dec >= 0.66:
        return ChatIntentResult(
            intent="decision_candidate",
            confidence=round(conf_dec, 3),
            decision_type="general",
            reasons=reasons,
            suggested_action="show_decision_report_prompt",
        )
    return ChatIntentResult(
        intent="normal",
        confidence=max(0.2, round(max(conf_role, conf_dec), 3)),
        reasons=reasons or ["no strong decision/roleplay signal"],
        suggested_action="continue",
    )


def detect_chat_intent(
    message: str,
    recent_messages: list[dict],
    user_profile_summary: str | None = None,
    *,
    llm_enabled: bool = True,
) -> ChatIntentResult:
    base = _heuristic(message)
    # Fast path: very high-confidence heuristic.
    if base.confidence >= 0.86 or not llm_enabled:
        return base
    # LLM path only for uncertain/mid-confidence region.
    if not (0.35 <= base.confidence <= 0.85):
        return base
    try:
        llm = build_openai_llm(temperature=0.05)
        recent = recent_messages[-5:] if recent_messages else []
        prompt = (
            "Classify chat intent for an AI decision assistant.\n"
            "Return strict JSON fields: intent, confidence, decision_type, reasons, suggested_action.\n"
            "intent must be one of: normal, decision_candidate, roleplay_candidate, memory_update_candidate.\n"
            "suggested_action must be one of: continue, show_decision_report_prompt, show_role_mode_prompt.\n"
            "Avoid false positives for coding/debugging/factual Q&A.\n\n"
            f"User profile summary:\n{user_profile_summary or '(none)'}\n\n"
            f"Recent messages:\n{recent}\n\n"
            f"Current message:\n{message.strip()}"
        )
        out = structured_predict(llm, _LLMIntentOut, prompt)
        parsed = out if isinstance(out, _LLMIntentOut) else _LLMIntentOut.model_validate(out)
        # Conservative blend: never raise confidence too aggressively.
        conf = min(1.0, max(base.confidence * 0.8, float(parsed.confidence) * 0.9))
        return ChatIntentResult(
            intent=parsed.intent,
            confidence=round(conf, 3),
            decision_type=parsed.decision_type,
            reasons=parsed.reasons or base.reasons,
            suggested_action=parsed.suggested_action,
        )
    except Exception:
        return base
