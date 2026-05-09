"""Slime Buddy identity: canonical name/persona from profile store + identity-question detection."""

from __future__ import annotations

import re
from dataclasses import dataclass

from foresight_x.config import Settings
from foresight_x.profile.store import load_user_profile
from foresight_x.schemas import SlimePersona, SlimePersonaTone
from foresight_x.voice.slime_persona_prompt import merge_slime_persona_defaults


@dataclass(frozen=True)
class EffectiveSlimePersona:
    """
    Single source of truth for Slime Buddy's display name and speaking persona.
    ``name`` comes from ``UserProfile.slime_profile.name`` when a profile exists; otherwise the
    product default (``Mochi``). ``profile_saved`` is False only when ``slime_profile`` is absent.
    """

    name: str
    persona: SlimePersona
    user_nickname_for_address: str
    profile_saved: bool


def get_effective_slime_persona(settings: Settings) -> EffectiveSlimePersona:
    """Load saved slime profile/persona for this user (trusted store)."""
    prof = load_user_profile(settings)
    sp = prof.slime_profile
    profile_saved = sp is not None
    raw_name = str(sp.name if sp else "").strip()[:24] if sp else ""
    name = raw_name or "Mochi"
    persona = merge_slime_persona_defaults(sp.persona if sp else None)
    nick = (persona.user_nickname or "").strip()
    addr = nick if nick else "you"
    return EffectiveSlimePersona(
        name=name,
        persona=persona,
        user_nickname_for_address=addr,
        profile_saved=profile_saved,
    )


_SLIME_ID_PATTERNS_EN = (
    r"what\s*('s| is)\s+your\s+name",
    r"what\s+(are you|do you)\s+called",
    r"who\s+are\s+you",
    r"what\s+should\s+i\s+call\s+you",
    r"what\s+do\s+i\s+call\s+you",
    r"do\s+you\s+have\s+a\s+name",
    r"what\s+is\s+your\s+name",
    r"tell\s+me\s+your\s+name",
)

# Chinese: what are you called / who are you
_CN_MARKERS = ("你叫什么", "你是谁", "你叫什么名字")

# User asks how the slime addresses *them* (not the slime's own name)
_USER_NICKNAME_PATTERNS_EN = (
    r"what\s+do\s+you\s+call\s+me",
    r"what\s+should\s+you\s+call\s+me",
    r"how\s+do\s+you\s+(call|address)\s+me",
    r"how\s+do\s+you\s+refer\s+to\s+me",
)
_CN_USER_NICK = ("你怎么叫我", "你叫我什么", "你管我叫什么", "你怎么称呼我")


def is_user_saved_nickname_question(text: str) -> bool:
    """User asks what nickname the slime uses for them (persona.user_nickname)."""
    raw = (text or "").strip()
    if not raw:
        return False
    low = raw.lower()
    if re.search(r"\bwhat\s+is\s+my\s+name\b", low):
        return False
    for m in _CN_USER_NICK:
        if m in raw:
            return True
    for pat in _USER_NICKNAME_PATTERNS_EN:
        if re.search(pat, low):
            return True
    return False


def format_user_nickname_reply(eff: EffectiveSlimePersona) -> str:
    nick = (eff.persona.user_nickname or "").strip()
    if not nick:
        return (
            "I don’t have a special nickname saved for you yet — you can set how I should refer to you "
            "in Slime Buddy personality settings."
        )
    p = eff.persona
    if p.tone in (SlimePersonaTone.PLAYFUL, SlimePersonaTone.WITTY) or p.humor >= 2:
        return f"I call you {nick}! That’s what you saved in your settings."
    if p.warmth >= 2:
        return f"I call you {nick} — that’s how you asked me to refer to you."
    return f"I call you {nick}."


def is_slime_identity_question(text: str) -> bool:
    """
    True if the user is asking the *assistant slime's* name/identity — not their own name
    (e.g. not "what is my name").
    """
    raw = (text or "").strip()
    if not raw:
        return False
    low = raw.lower()

    if re.search(r"\bwhat\s+is\s+my\s+name\b", low):
        return False
    if re.search(r"\bmy\s+name\s+is\b", low):
        return False
    if re.search(r"\b(call me|name me)\b", low) and "your" not in low:
        return False
    if low.startswith("i'm ") or low.startswith("im ") or low.startswith("i am "):
        return False

    for m in _CN_MARKERS:
        if m in raw:
            return True

    for pat in _SLIME_ID_PATTERNS_EN:
        if re.search(pat, low):
            return True
    # 怎么称呼你 = how to address "you" (the slime) in Chinese
    if "怎么称呼你" in raw:
        return True
    return False


def format_slime_identity_reply(eff: EffectiveSlimePersona) -> str:
    """Deterministic reply for identity questions (no LLM — preserves exact saved name)."""
    if not eff.profile_saved:
        return (
            "I don’t have a Slime profile saved yet, so I don’t have a name on file. "
            "You can name me in Slime Buddy / Profile settings."
        )
    n = eff.name
    addr = eff.user_nickname_for_address
    tone = eff.persona.tone
    if tone == SlimePersonaTone.DIRECT or eff.persona.directness >= 2:
        if addr != "you":
            return f"I'm {n}, your Slime Buddy, {addr}."
        return f"I'm {n}. I'm your Slime Buddy."
    if tone in (SlimePersonaTone.PLAYFUL, SlimePersonaTone.WITTY):
        if addr != "you":
            return f"I'm {n}! Your Slime Buddy — nice to say hi, {addr}."
        return f"I'm {n} — your Slime Buddy!"
    if addr != "you":
        return f"I'm {n}, your Slime Buddy, {addr}."
    return f"I'm {n}, your Slime Buddy."
