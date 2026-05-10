"""Slime Buddy intent routing — separates slime identity, user memory, thread, and practical asks."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

SlimeIntent = Literal[
    "slime_self_question",
    "user_memory_question",
    "current_thread_question",
    "practical_help_request",
    "decision_candidate",
    "calendar_command",
    "profile_update",
    "general_chat",
    "unknown",
]


class SlimeIntentResult(BaseModel):
    intent: SlimeIntent = "general_chat"
    secondary: SlimeIntent | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


_CALENDAR_MARKERS_EN = (
    "add to calendar",
    "put on my calendar",
    "schedule ",
    "calendar ",
    "remind me ",
    "block ",
    "appointment ",
)

_PROFILE_MARKERS_EN = (
    "call me ",
    "rename you",
    "your name is",
    "refer to me as",
    "叫我",
    "称呼我",
)

_THREAD_MARKERS_EN = (
    r"\bwhat did i just (say|ask)\b",
    r"\brepeat what i\b",
    r"\b刚才\b",
    r"\b前面说的\b",
    r"\bearlier in this chat\b",
)

_MEMORY_SELF_EN = (
    r"\bwho am i\b",
    r"\bwhat('s| is) my name\b",
    r"\bwhat do i like\b",
    r"\bwhat did i say yesterday\b",
    r"\bwhat did we talk about\b",
    r"\bwhat('s| is) saved about me\b",
)

# Third-party / factual recall about people — usually user memory, not slime self.
_MEMORY_OTHER_EN = (
    r"\bwho is\b",
    r"\bwho('s| was)\b",
    r"\bwhat do you know about\b",
)

_SLIME_SELF_EN = (
    r"\bwhat('s| is) your name\b",
    r"\bwho are you\b",
    r"\bwhat are you\b",
    r"\bdo you like your name\b",
    r"\bare you me\b",
    r"\bare you my (pet|assistant|companion|helper|buddy)\b",
    r"\bwhat can you do\b",
    r"\bwhat should i call you\b",
    r"\bwhat kind of slime\b",
    r"\btell me about yourself\b",
)

_PRACTICAL_AMBIGUOUS_HINTS = (
    "paper",
    "document",
    "file",
    "link",
    "more ",
    "any more",
    "think any",
)


def classify_slime_intent(message: str, *, recent_snippet: str = "") -> SlimeIntentResult:
    """
    Lightweight heuristic classifier for Slime Buddy routing.
    ``recent_snippet`` optional concatenated recent user lines for thread-ish cues.
    """
    raw = (message or "").strip()
    if not raw:
        return SlimeIntentResult(intent="unknown", confidence=0.2)
    low = raw.lower()
    combo = f"{recent_snippet}\n{raw}".lower()

    if any(low.startswith(m) or m in low for m in _CALENDAR_MARKERS_EN):
        return SlimeIntentResult(intent="calendar_command", confidence=0.78)
    if any(m in low for m in _PROFILE_MARKERS_EN):
        return SlimeIntentResult(intent="profile_update", confidence=0.72)

    for pat in _THREAD_MARKERS_EN:
        if re.search(pat, low):
            return SlimeIntentResult(intent="current_thread_question", confidence=0.8)

    for pat in _SLIME_SELF_EN:
        if re.search(pat, low):
            return SlimeIntentResult(intent="slime_self_question", confidence=0.88)

    for pat in _MEMORY_SELF_EN:
        if re.search(pat, low):
            return SlimeIntentResult(intent="user_memory_question", confidence=0.82)

    for pat in _MEMORY_OTHER_EN:
        if re.search(pat, low):
            return SlimeIntentResult(intent="user_memory_question", confidence=0.68)

    # Short ambiguous practical fragments — prefer clarification over psychologizing.
    if len(raw) <= 96 and "?" in raw:
        if any(h in low for h in _PRACTICAL_AMBIGUOUS_HINTS):
            if not any(k in low for k in ("worth", "value", "anxiety", "depress", "therapy", "trauma")):
                return SlimeIntentResult(intent="practical_help_request", confidence=0.62)

    if "?" in raw and len(raw.split()) <= 14:
        if not any(k in low for k in ("i feel", "worthless", "valuable", "value as a person")):
            # Weak signal — general_chat unless caller merges with decision detector.
            return SlimeIntentResult(intent="practical_help_request", confidence=0.45)

    return SlimeIntentResult(intent="general_chat", confidence=0.35)


def merge_with_decision_intent(slime: SlimeIntentResult, decision_like: bool) -> SlimeIntentResult:
    if decision_like and slime.intent not in ("slime_self_question", "calendar_command", "profile_update"):
        return SlimeIntentResult(
            intent="decision_candidate",
            secondary=slime.intent if slime.intent != "general_chat" else None,
            confidence=max(slime.confidence, 0.72),
        )
    return slime
