"""How Slimes should address the human user."""

from __future__ import annotations

from foresight_x.schemas import UserProfile


def resolve_user_preferred_name(prof: UserProfile) -> str | None:
    """
    Canonical display name for the user (Profile field first, then slime persona nickname).
    Returns None when unknown — callers should fall back to «you».
    """
    pn = (getattr(prof, "preferred_name", None) or "").strip()
    if pn:
        return pn[:48]
    sp = prof.slime_profile
    if sp and sp.persona:
        nick = (sp.persona.user_nickname or "").strip()
        if nick:
            return nick[:24]
    return None


def user_address_for_prompt(prof: UserProfile) -> str:
    """«Name» for prompts, or «you» when unset."""
    name = resolve_user_preferred_name(prof)
    return name if name else "you"
