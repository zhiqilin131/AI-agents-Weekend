"""Resolve canonical SlimeSelfModel from stored profile + defaults."""

from __future__ import annotations

from foresight_x.config import Settings
from foresight_x.profile.store import load_user_profile
from foresight_x.profile.user_address import resolve_user_preferred_name
from foresight_x.schemas import SlimeSelfModel, SlimeProfile
from foresight_x.slime.identity import SlimeType, get_slime_identity
from foresight_x.voice.slime_persona_prompt import merge_slime_persona_defaults


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


def get_effective_slime_self_model(
    user_id: str,
    *,
    settings: Settings,
    slime_type: SlimeType = "generalized",
) -> SlimeSelfModel:
    """
    Canonical slime self model for ``user_id``.
    ``settings.foresight_user_id`` should match ``user_id`` for authenticated requests.
    Slime display name is fixed per ``slime_type`` (not user-customizable).
    """
    _ = (user_id or "").strip()  # reserved for multi-tenant checks
    ident = get_slime_identity(slime_type)
    prof = load_user_profile(settings)
    sp = prof.slime_profile
    profile_saved = sp is not None
    stored = ident.ui_spoken_name
    spoken = ident.ui_spoken_name

    persona = merge_slime_persona_defaults(ident.fixed_persona)
    if sp and sp.persona:
        stored_persona = merge_slime_persona_defaults(sp.persona)
        if stored_persona.companion_relationship:
            persona = persona.model_copy(
                update={"companion_relationship": stored_persona.companion_relationship}
            )
    nick = resolve_user_preferred_name(prof)
    if nick:
        persona = persona.model_copy(update={"user_nickname": nick})
    preset = persona.personality_preset.value if hasattr(persona.personality_preset, "value") else str(persona.personality_preset)
    tone = persona.tone.value if hasattr(persona.tone, "value") else str(persona.tone)

    rel = persona.companion_relationship or "helper_pet_companion"

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
        name_safe_for_ui=True,
        spoken_name=spoken,
    )


def slime_profile_for_prompt(
    sp: SlimeProfile | None,
    *,
    slime_type: SlimeType = "generalized",
) -> tuple[str, bool]:
    """Resolved slime name for prompts — fixed per Slime type."""
    _ = sp
    ident = get_slime_identity(slime_type)
    return ident.ui_spoken_name, True
