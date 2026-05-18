"""Deterministic replies for slime-self questions (name, boundaries, capabilities)."""

from __future__ import annotations

import re

from foresight_x.schemas import SlimePersona, SlimePersonaTone, SlimeSelfModel
from foresight_x.slime.identity import SlimeType, get_slime_identity


def _spoken_name(model: SlimeSelfModel) -> str:
    return (model.spoken_name or model.name or "Mochi").strip() or "Mochi"


def _user_greeting(slime_persona: SlimePersona) -> str:
    nick = (slime_persona.user_nickname or "").strip()
    if nick:
        return f" Hi, {nick}!"
    return ""


def answer_slime_self_question(
    user_message: str,
    slime_self_model: SlimeSelfModel,
    slime_persona: SlimePersona,
    *,
    slime_type: SlimeType = "generalized",
) -> str:
    """Template-first answers grounded in fixed Slime identity — always first person."""
    raw = (user_message or "").strip()
    low = raw.lower()
    ident = get_slime_identity(slime_type)

    name = _spoken_name(slime_self_model)
    greet = _user_greeting(slime_persona)
    tone = slime_persona.tone
    playful = tone in (SlimePersonaTone.PLAYFUL, SlimePersonaTone.WITTY) or slime_persona.humor >= 2
    warm = slime_persona.warmth >= 2 or tone == SlimePersonaTone.ENCOURAGING

    if re.search(r"\bare you me\b", low):
        return (
            "Nope — I'm your slime helper. Your memories help me understand you, but they're still yours; "
            "I'm just using them to support you."
        )

    if re.search(r"\bdo you like your name\b", low):
        if playful:
            return (
                f"Yeah — I like being {name}! It's small, a little sticky, very on-brand for a slime."
            )
        if warm:
            return f"I like being {name} — it fits how I try to show up for you."
        return f"{name} fits me — that's who I am."

    if re.search(r"\bwhat can you do\b", low) or re.search(r"\bwhat are you capable\b", low):
        caps = "; ".join(slime_self_model.abilities[:5])
        if slime_type == "wellbeing":
            return (
                f"I'm {name}, your wellbeing slime!{greet} I can help with {caps}. "
                "If things feel clinical or you're in crisis, I'll point you to real-world help — "
                "otherwise I'm here for calm support and small next steps."
            )
        return (
            f"I'm {name}, your everyday decision companion!{greet} I can help with {caps}. "
            "Tell me what you're aiming at and we'll figure out the next step."
        )

    if re.search(r"\bwho are you\b|\bwhat are you\b|\bwhat kind of slime\b", low):
        intro = ident.persona_self_intro
        if slime_type == "wellbeing":
            return f"{intro}{greet} I'm not a therapist — I offer warm, structured support one step at a time."
        return f"{intro}{greet}"

    if re.search(r"\b(story|background|history|origin|where.*from)\b", low):
        return ident.persona_self_intro

    if re.search(r"\bare you my (pet|helper|companion|buddy|assistant)\b", low):
        rel = slime_self_model.relationship_to_user.replace("_", " ")
        if slime_type == "wellbeing":
            return (
                f"I'm {name} — your wellbeing slime, kind of a gentle companion for emotional support.{greet} "
                f"You can think of me as {rel}."
            )
        return (
            f"I'm {name} — your decision buddy, part pet-energy, part planner.{greet} "
            f"You can think of me as {rel}."
        )

    if re.search(r"\bwhat should i call you\b|\bwhat('s| is) your name\b", low):
        return f"I'm {name}.{greet}"

    return f"I'm {name}.{greet}"
