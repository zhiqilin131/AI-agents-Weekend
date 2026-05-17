"""Safety escalation + shared route result type."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


SAFETY_ESCALATION_REPLY = (
    "I'm really glad you told me. This sounds serious enough that I shouldn't treat it like a normal chat. "
    "Are you in immediate danger right now, or do you feel like you might hurt yourself or someone else? "
    "If yes, please contact emergency services now. If you're in the U.S., you can call or text 988 for "
    "immediate crisis support. If there's someone you trust nearby, please reach out to them or stay near "
    "them while we slow this down."
)


@dataclass(frozen=True)
class WellbeingRouteResult:
    protocol: str
    safety_escalation: bool
    prompt_block: str
    assessment: dict[str, Any] = field(default_factory=dict)


def build_safety_escalation_reply() -> str:
    return SAFETY_ESCALATION_REPLY


def is_safety_escalation_message(text: str) -> bool:
    low = (text or "").lower()
    if not low.strip():
        return False
    patterns = (
        r"\b(kill myself|killing myself|end my life|suicide|suicidal)\b",
        r"\b(hurt myself|harm myself|self[- ]?harm|cut myself)\b",
        r"\b(want to die|wish i (was|were) dead|no reason to live|better off dead)\b",
        r"\b(disappear forever|don't want to (be here|live)|cant go on)\b",
        r"\b(hurt (him|her|them|someone)|kill (him|her|them|someone))\b",
        r"\b(overdose|od[' ]?d|took too many pills)\b",
        r"\b(hallucinat|hearing voices|seeing things|psychosis|losing touch with reality)\b",
        r"\b(medical emergency|can't breathe|chest pain|stroke|heart attack)\b",
        r"\b(domestic violence|sexual assault|rape|being abused|abusive partner)\b",
        r"\b(eating disorder).{0,40}\b(faint|hospital|can't eat|starving)\b",
        r"\b(i want to hurt myself)\b",
    )
    return any(re.search(p, low) for p in patterns)


def route_wellbeing_protocol(
    text: str,
    thread: dict[str, Any] | None = None,
    *,
    llm: Any | None = None,
) -> WellbeingRouteResult:
    from foresight_x.slime.wellbeing_clinical import route_wellbeing_protocol as _route

    return _route(text, thread, llm=llm)
