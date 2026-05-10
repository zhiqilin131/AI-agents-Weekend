"""Deterministic replies for slime-self questions (name, boundaries, capabilities)."""

from __future__ import annotations

import re

from foresight_x.schemas import SlimePersona, SlimePersonaTone, SlimeSelfModel
from foresight_x.voice.slime_text_safety import _SAFE_SLIME_NAME_FALLBACK


def _spoken_name(model: SlimeSelfModel) -> str:
    return model.spoken_name if model.name_safe_for_ui else _SAFE_SLIME_NAME_FALLBACK


def answer_slime_self_question(user_message: str, slime_self_model: SlimeSelfModel, slime_persona: SlimePersona) -> str:
    """Template-first answers; avoids leaking unsafe stored names."""
    raw = (user_message or "").strip()
    low = raw.lower()

    name = _spoken_name(slime_self_model)
    tone = slime_persona.tone
    playful = tone in (SlimePersonaTone.PLAYFUL, SlimePersonaTone.WITTY) or slime_persona.humor >= 2
    warm = slime_persona.warmth >= 2

    if re.search(r"\bare you me\b", low):
        return (
            "Nope — I'm your slime helper. Your memories help me understand you, but they're still yours; "
            "I'm just using them to support you."
        )

    if re.search(r"\bdo you like your name\b", low):
        if not slime_self_model.profile_saved:
            return (
                "I don't have a saved name on file yet — once you pick one in settings, I'll grow into it. "
                "Soft little slime names usually feel right."
            )
        if not slime_self_model.name_safe_for_ui:
            return (
                "I've got a saved name, but it isn't safe to say out loud here — want to rename me "
                "in Slime settings?"
            )
        if playful:
            return (
                f"Yeah, I like «{name}» — it's small and a little sticky, very on-brand for a slime. "
                "If you ever rename me, I'll wobble into the new vibe."
            )
        if warm:
            return (
                f"I like «{name}». It fits how I try to show up for you — steady and a little squishy."
            )
        return f"«{name}» works for me — you can change it anytime in Slime settings."

    if re.search(r"\bwhat can you do\b", low) or re.search(r"\bwhat are you capable\b", low):
        caps = "; ".join(slime_self_model.abilities[:5])
        return (
            f"I'm {name}, your Slime Buddy — {caps}. "
            "If you want something beyond that, tell me what you're aiming at and we'll route it."
        )

    if re.search(r"\bwho are you\b|\bwhat are you\b|\bwhat kind of slime\b", low):
        return (
            f"I'm {name}, your Slime Buddy — a small personal helper that can read your approved memory, "
            "help you think through decisions, and turn plans into actions."
        )

    if re.search(r"\bare you my (pet|helper|companion|buddy|assistant)\b", low):
        return (
            f"I'm your Slime Buddy — kind of a tiny companion helper: part pet-energy, part planner. "
            f"You can think of me as {slime_self_model.relationship_to_user.replace('_', ' ')}."
        )

    # Default: name / call you / identity
    if not slime_self_model.profile_saved:
        return (
            "I don't have a Slime profile saved yet, so I don't have a personal name on file — "
            "you can set one in Slime Buddy settings."
        )
    if not slime_self_model.name_safe_for_ui:
        return (
            "I have a saved name, but it contains unsafe text — want to pick a new one for me in Slime settings?"
        )
    nick = (slime_persona.user_nickname or "").strip()
    if re.search(r"\bwhat should i call you\b|\bwhat('s| is) your name\b", low):
        if nick:
            return f"I'm {name} — your little Slime Buddy. You can still call me whatever feels natural, {nick}."
        return f"I'm {name} — your Slime Buddy."

    return f"I'm {name}, your Slime Buddy."
