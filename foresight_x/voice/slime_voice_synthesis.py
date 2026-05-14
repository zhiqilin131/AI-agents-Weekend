"""Persona-aware rendering of neutral tool replies."""

from __future__ import annotations

import re

from foresight_x.config import Settings
from foresight_x.schemas import SlimePersona, SlimePersonaTone
from foresight_x.voice.slime_identity import EffectiveSlimePersona, get_effective_slime_persona


def apply_voice_persona_template(
    neutral_reply: str,
    *,
    tool_name: str,
    eff: EffectiveSlimePersona,
) -> str:
    """
    Deterministic persona surface when no LLM is configured — still uses saved nickname, tone, length.
    """
    n = (neutral_reply or "").strip()
    if not n:
        return n
    p = eff.persona
    nick = (eff.user_nickname_for_address or "").strip() or "you"
    playful = p.tone in (SlimePersonaTone.PLAYFUL, SlimePersonaTone.WITTY) or p.humor >= 2
    encouraging = p.tone == SlimePersonaTone.ENCOURAGING
    warm = p.warmth >= 2

    # Short replies: first sentence or trim
    if p.reply_length == "short":
        m = re.match(r"^[\s\S]{1,500}?[.!?](?=\s|$)", n)
        if m:
            n = m.group(0).strip()
        elif len(n) > 140:
            n = n[:137].rsplit(" ", 1)[0] + "…"

    if nick == "you":
        return n[:900]

    nk = nick.lower()
    if n.lower().startswith(nk):
        return n[:900]

    # Opening / navigate: friendlier lead-in
    if tool_name == "navigate" and n.lower().startswith("opening"):
        rest = re.sub(r"^opening\s+", "", n, flags=re.I).strip().rstrip(".")
        rest_pretty = rest.replace("_", " ") if rest else "that page"
        if playful:
            line = f"You got it, {nick} — opening {rest_pretty}."
        elif warm or encouraging:
            line = f"{nick}, opening {rest_pretty}."
        else:
            line = f"{nick} — opening {rest_pretty}."
        return line[:900]

    if playful:
        lead = f"{nick}, "
        body = n[0].lower() + n[1:] if len(n) > 1 else n
        out = lead + body
        if "!" not in out[-4:] and p.humor >= 2:
            out = out.rstrip(".") + "!"
        return out[:900]

    if warm or p.directness <= 1:
        lead = f"{nick}, "
        body = n[0].lower() + n[1:] if len(n) > 1 else n
        return (lead + body)[:900]

    return f"{nick} — {n}"[:900]


def synthesize_persona_spoken_reply(
    *,
    neutral_reply: str,
    transcript: str,
    tool_name: str,
    slime_persona: SlimePersona | None,
    slime_name: str,
    user_ref: str,
    settings: Settings,
    slime_profile_saved: bool = True,
    effective: EffectiveSlimePersona | None = None,
) -> str:
    """Fast persona surface for short tool confirmations.

    Voice tools sit on the latency-sensitive path: a navigation/profile/calendar
    acknowledgement should not wait for another LLM call after routing. Full
    conversational quality still comes from the main chat turn and memory answer
    synthesis; this helper keeps small tool replies instant and deterministic.
    """
    eff = effective or get_effective_slime_persona(settings)
    n = (neutral_reply or "").strip()
    if not n:
        return n

    return apply_voice_persona_template(n, tool_name=tool_name, eff=eff)
