"""Resolve canonical SlimeSelfModel from stored profile + defaults."""

from __future__ import annotations

from foresight_x.config import Settings
from foresight_x.profile.store import load_user_profile
from foresight_x.schemas import SlimeSelfModel, SlimeProfile
from foresight_x.voice.slime_persona_prompt import merge_slime_persona_defaults
from foresight_x.voice.slime_text_safety import is_safe_slime_display_name


_DEFAULT_ABILITIES = (
    "chat with the user",
    "read approved user memory",
    "summarize past context",
    "help with decisions",
    "create calendar drafts",
    "personalize its own style",
)

_DEFAULT_LIMITATIONS = (
    "cannot know things outside stored memory or current context unless searched",
    "cannot change persistent user data without confirmation",
    "cannot treat its own identity as the user's identity",
)

_DEFAULT_BOUNDARIES = (
    "User memory describes the user, not the Slime",
    "Slime persona describes the Slime, not the user",
    "Do not over-psychologize ordinary questions",
    "Ask practical clarification before emotional interpretation",
)


def get_effective_slime_self_model(user_id: str, *, settings: Settings) -> SlimeSelfModel:
    """
    Canonical slime self model for ``user_id``.
    ``settings.foresight_user_id`` should match ``user_id`` for authenticated requests.
    """
    _ = (user_id or "").strip()  # reserved for multi-tenant checks
    prof = load_user_profile(settings)
    sp = prof.slime_profile
    profile_saved = sp is not None
    raw_name = str(sp.name if sp else "").strip()[:24] if sp else ""
    stored = raw_name or "Mochi"
    name_safe = is_safe_slime_display_name(stored)
    spoken = stored if name_safe else "your Slime Buddy"

    persona = merge_slime_persona_defaults(sp.persona if sp else None)
    preset = persona.personality_preset.value if hasattr(persona.personality_preset, "value") else str(persona.personality_preset)
    tone = persona.tone.value if hasattr(persona.tone, "value") else str(persona.tone)

    rel = persona.companion_relationship or "helper_pet_companion"
    nick = (persona.user_nickname or "").strip() or None

    return SlimeSelfModel(
        name=stored,
        species="slime",
        role="personal_companion_agent",
        relationship_to_user=rel,
        user_reference_name=nick,
        personality_preset=preset,
        tone=tone,
        warmth=int(persona.warmth),
        humor=int(persona.humor),
        directness=int(persona.directness),
        reply_length=str(persona.reply_length),
        abilities=list(_DEFAULT_ABILITIES),
        limitations=list(_DEFAULT_LIMITATIONS),
        boundaries=list(_DEFAULT_BOUNDARIES),
        profile_saved=profile_saved,
        name_safe_for_ui=name_safe,
        spoken_name=spoken,
    )


def slime_profile_for_prompt(sp: SlimeProfile | None) -> tuple[str, bool]:
    """Resolved slime name for prompts (never unsafe verbatim)."""
    if not sp:
        return "Mochi", True
    raw = str(sp.name or "").strip()[:24] or "Mochi"
    if is_safe_slime_display_name(raw):
        return raw, True
    return "your Slime Buddy", False
