"""Persona-aware rewrite of neutral tool replies (after strict routing + tool execution)."""

from __future__ import annotations

import logging
import re

from pydantic import BaseModel, Field

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.schemas import SlimePersona, SlimePersonaTone
from foresight_x.structured_predict import structured_predict
from foresight_x.voice.slime_identity import EffectiveSlimePersona, get_effective_slime_persona
from foresight_x.voice.slime_persona_prompt import build_slime_persona_prompt, merge_slime_persona_defaults

_log = logging.getLogger(__name__)


class _SpokenOut(BaseModel):
    text: str = Field(..., max_length=900)


_REPHRASE = """Rewrite the assistant line for voice. The persona block is authoritative for STYLE.

CRITICAL style rules:
- Address the user using their preferred form from the persona block when natural — at least once in this reply if it fits (not every sentence).
- Match tone, warmth, humor, and directness from the persona block. If tone is playful, be lightly playful; if warmth is high, be buddy-like.
- Obey reply length: if "short", use at most TWO short sentences total.
- Keep all facts, route names, times, and confirmation requirements identical to the neutral draft.
- Do not claim actions happened if the draft only proposes or asks for confirmation.
- Do not remove required confirmations.
- If the neutral draft states the Slime's name, keep that name exactly — do not change or omit it.

{persona_block}

User said (context):
{transcript}

Neutral draft (preserve meaning and factual content):
{neutral}

Return one speakable reply, no markdown, no bullet labels."""


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
    """LLM polish when API key present; otherwise template persona surface (never raw generic only)."""
    eff = effective or get_effective_slime_persona(settings)
    n = (neutral_reply or "").strip()
    if not n:
        return n

    if not (settings.openai_api_key or "").strip():
        return apply_voice_persona_template(n, tool_name=tool_name, eff=eff)

    persona = merge_slime_persona_defaults(slime_persona)
    block = build_slime_persona_prompt(
        persona,
        f"voice_tool:{tool_name}",
        slime_name=slime_name,
        user_ref=user_ref,
        slime_profile_saved=slime_profile_saved,
    )
    prompt = _REPHRASE.format(
        persona_block=block,
        transcript=(transcript or "").strip()[:2000],
        neutral=n[:1200],
    )
    llm = build_openai_llm(settings, temperature=0.52)
    try:
        out = structured_predict(llm, _SpokenOut, prompt)
    except Exception as e:
        _log.warning("persona spoken synthesis failed: %s", e)
        return apply_voice_persona_template(n, tool_name=tool_name, eff=eff)
    t = (out.text or "").strip()
    if not t:
        return apply_voice_persona_template(n, tool_name=tool_name, eff=eff)
    return t[:900]
