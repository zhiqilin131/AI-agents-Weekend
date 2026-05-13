from __future__ import annotations

import re

from pydantic import BaseModel, Field


class ChatModeDetection(BaseModel):
    intent: str = "normal"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    suggested_action: str = "continue"


ROLEPLAY_KEYWORDS = [
    "pretend to be",
    "act as",
    "roleplay",
    "you are now",
    "simulate being",
    "扮演",
    "角色",
    "你现在是",
    "模拟",
    "进入剧情",
    "玩一个游戏",
]

DECISION_KEYWORDS = [
    "should i",
    "which option",
    "help me decide",
    "help me choose",
    "choose for me",
    "pick for me",
    "pick a number",
    "choose a number",
    "pros and cons",
    "tradeoff",
    "risk",
    "bet on",
    "roulette",
    "winning number",
    "red or black",
    "black or red",
    "consequence",
    "我该不该",
    "要不要",
    "帮我决定",
    "选哪个",
    "利弊",
    "风险",
    "后果",
]

GAMBLING_DECISION_RE = re.compile(
    r"\b("
    r"roulette|casino|blackjack|bet(?:ting)?|wager|"
    r"winning\s+(?:number|pick|bet)|"
    r"(?:red|black)\s+or\s+(?:red|black)|"
    r"which\s+(?:number|color|side)\s+(?:should\s+i\s+)?(?:bet|pick|choose)|"
    r"(?:pick|choose|give\s+me)\s+(?:a\s+)?(?:winning\s+)?(?:number|color|side)"
    r")\b",
    re.I,
)


def detect_chat_mode_intent(
    user_message: str,
    recent_messages: list[dict] | None = None,
) -> ChatModeDetection:
    text = (user_message or "").strip().lower()
    if not text:
        return ChatModeDetection()

    role_hits = [k for k in ROLEPLAY_KEYWORDS if k in text]
    decision_hits = [k for k in DECISION_KEYWORDS if k in text]
    reasons: list[str] = []
    role_conf = min(1.0, 0.45 + 0.2 * len(role_hits)) if role_hits else 0.0
    decision_conf = min(1.0, 0.3 + 0.18 * len(decision_hits)) if decision_hits else 0.0

    if "option a" in text and "option b" in text:
        decision_conf = max(decision_conf, 0.72)
        reasons.append("contains explicit A/B options")
    if GAMBLING_DECISION_RE.search(text):
        decision_conf = max(decision_conf, 0.74)
        reasons.append("chance/gambling choice request")

    if role_hits:
        reasons.append(f"roleplay cues: {', '.join(role_hits[:3])}")
    if decision_hits:
        reasons.append(f"decision cues: {', '.join(decision_hits[:3])}")

    if role_conf >= 0.62 and role_conf > decision_conf:
        return ChatModeDetection(
            intent="roleplay_candidate",
            confidence=round(role_conf, 3),
            reasons=reasons,
            suggested_action="show_role_mode_prompt",
        )
    if decision_conf >= 0.62:
        return ChatModeDetection(
            intent="decision_candidate",
            confidence=round(decision_conf, 3),
            reasons=reasons,
            suggested_action="show_decision_report_prompt",
        )
    return ChatModeDetection(
        intent="normal",
        confidence=max(0.2, round(max(role_conf, decision_conf), 3)),
        reasons=reasons or ["no high-confidence mode signal"],
        suggested_action="continue",
    )
