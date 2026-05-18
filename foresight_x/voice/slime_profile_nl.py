"""Apply Slime Studio-style settings from natural chat (buddy voice + slime_voice threads)."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.chat.slime_intent import classify_slime_intent
from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.profile.slime_merge import merge_and_save_slime_profile
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)


class _SlimeStudioNlPatch(BaseModel):
    applies_to_slime_personalization: bool = Field(
        description="True only if the user is asking to change Slime appearance, voice, or speaking persona.",
    )
    patch: dict[str, Any] = Field(
        default_factory=dict,
        description="Partial slime profile JSON (snake_case keys). Only include fields being changed.",
    )
    reply: str = Field(
        default="Done — I updated my look or voice how you asked.",
        description="Short in-character confirmation (one or two sentences).",
    )


_STYLE_GATE_EXTRA = (
    "make yourself",
    "make your ",
    "switch your theme",
    "change your theme",
    "change your color",
    "change your tone",
    "change your shape",
    "change your role",
    "your role",
    "who you are",
    "persona",
    "warmer tone",
    "more playful",
    "more serious",
    "be more ",
    "slime color",
    "read aloud",
    "voice output",
    "your voice",
    "change your voice",
    "speak slower",
    "speak faster",
    "talk slower",
    "lower pitch",
    "higher pitch",
    "tts",
    "rename yourself",
    "your accessory",
    "personality preset",
    "reply length",
    "catchphrase",
    "custom hex",
    "#",
)


def should_attempt_nl_slime_patch(message: str) -> bool:
    """Cheap gate before calling the NL patch model."""
    raw = (message or "").strip()
    if len(raw) < 4 or len(raw) > 900:
        return False
    si = classify_slime_intent(raw)
    if si.intent == "profile_update":
        # Appearance, voice, and speaking style are fixed per Slime type.
        return False
    low = raw.lower()
    return any(s in low for s in _STYLE_GATE_EXTRA)


_SLIME_NL_PROMPT = """You interpret user messages for Slime Buddy personalization (Slime Studio).

Decide if they want to change THEIR slime companion's settings (look, motion, read-aloud voice, speaking persona).
NOT general chat, NOT unrelated facts.

If yes, set applies_to_slime_personalization=true and fill patch using snake_case keys ONLY for fields they clearly want to change.

Allowed top-level patch keys:
- name (string, slime character name, max 24 chars)
- color_theme: aurora | violet | mint | sunset | lime | silver | custom
- custom_colors: object {{ primary, secondary, glow }} as #RRGGBB hex strings (only if theme custom or they give hex)
- personality: calm | direct | encouraging | analytical | playful | cautious  (legacy mood enum)
- shape: classic | orb | robot | crystal | ghost
- accessory: none | glasses | halo | antenna | scarf | spark
- motion: subtle | normal | expressive
- voice: {{ enabled: bool, rate: number 0.5-2, pitch: number 0.5-2, preferred_voice_name: onyx|echo|fable|alloy|nova|shimmer optional }}

Nested persona object (partial merge) — optional keys:
- user_nickname or userNickname (how slime addresses the human)
- companion_relationship: helper | pet | companion | coach | tiny_robot_slime_assistant | helper_pet_companion | assistant
- personality_preset: calm_advisor | direct_strategist | warm_friend | playful_pet | analytical_coach | hype_buddy | gentle_companion | minimalist_assistant
- tone: calm | warm | direct | playful | analytical | encouraging | witty | concise
- warmth, humor, directness: integers 0-3
- reply_length: short | balanced | detailed
- role_identity: string max ~500 chars (who the slime is)
- catchphrases: list of up to 3 short strings
- donts: list of up to 5 short boundary lines

Examples:
- "Go mint theme and tiny robot shape" -> color_theme mint, shape robot
- "Call me Captain" -> persona {{ user_nickname: Captain }}
- "Rename yourself Glorb" -> name Glorb
- "Turn off read aloud" -> voice {{ enabled: false }}
- "Speak slower" -> voice {{ rate: 0.85 }}
- "Playful preset, more humor" -> persona {{ personality_preset: playful_pet, humor: 3 }}
- "Change who you are / your role to …" -> persona {{ role_identity: "<concise paraphrase of what they asked for within safety limits>" }}

If unclear or not about slime settings: applies_to_slime_personalization=false, patch {{}}, reply brief refusal or ask one clarifying question.

User message:
{message}
"""


def try_apply_slime_profile_from_chat_message(message: str, *, settings: Settings) -> tuple[bool, str]:
    """
    Try to parse and persist a slime profile patch from chat.
    Returns (applied, assistant_reply_text).
    """
    raw = (message or "").strip()
    if not raw or not should_attempt_nl_slime_patch(raw):
        return False, ""
    if not (settings.openai_api_key or "").strip():
        return False, ""

    try:
        llm = build_openai_llm(settings, temperature=0.08)
        prompt = _SLIME_NL_PROMPT.format(message=raw[:2800])
        out = structured_predict(llm, _SlimeStudioNlPatch, prompt)
    except Exception as e:
        _log.warning("slime NL patch LLM failed: %s", e)
        return False, ""

    if not out.applies_to_slime_personalization or not isinstance(out.patch, dict):
        return False, ""

    patch = {k: v for k, v in out.patch.items() if v is not None}
    if not patch:
        return False, ""

    from foresight_x.voice.slime_tools import _reject_slime_personalization_patch

    blocked = _reject_slime_personalization_patch(patch)
    if blocked:
        return True, blocked

    ok, err = merge_and_save_slime_profile(settings, patch)
    if not ok:
        _log.info("slime NL patch merge failed: %s", err)
        return False, ""

    reply = (out.reply or "Updated my Slime settings.").strip()
    return True, reply[:1200]
