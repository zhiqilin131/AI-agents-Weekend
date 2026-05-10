"""Apply Slime profile JSON patches (same rules as PATCH /api/profile/slime) without FastAPI."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from foresight_x.config import Settings
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import SlimeColorTheme, SlimeProfile, SlimeProfilePatch, UserProfile
from foresight_x.voice.slime_persona_prompt import merge_persona_patch, merge_slime_persona_defaults
from foresight_x.voice.slime_text_safety import is_safe_slime_display_name


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def merge_and_save_slime_profile(settings: Settings, raw_body: dict[str, Any]) -> tuple[bool, str]:
    """
    Merge validated slime fields into the active user profile and persist.
    Mirrors ``patch_slime_profile`` in ``api_server``.
    Returns (success, error_message).
    """
    existing = load_user_profile(settings)
    raw_body = dict(raw_body or {})
    try:
        patch = SlimeProfilePatch.from_api_payload(raw_body)
    except ValidationError as e:
        return False, f"invalid_patch:{e}"

    stored = existing.slime_profile or SlimeProfile(name="Mochi", updated_at="")
    updates = patch.model_dump(exclude_unset=True)
    updates.pop("persona", None)
    if "persona" in raw_body:
        if raw_body.get("persona") is None:
            updates["persona"] = None
        elif isinstance(raw_body.get("persona"), dict):
            cur = merge_slime_persona_defaults(stored.persona)
            try:
                new_persona = merge_persona_patch(cur, raw_body["persona"])
            except ValidationError:
                return False, "invalid_persona_patch"
            updates["persona"] = new_persona.model_copy(update={"updated_at": _utc_now()})

    if not updates:
        return False, "empty_patch"

    if "custom_colors" in updates and "color_theme" not in updates:
        updates["color_theme"] = SlimeColorTheme.CUSTOM
    if updates.get("name") is not None and not is_safe_slime_display_name(str(updates["name"]).strip()):
        updates["name"] = "Mochi"

    try:
        merged_stored = SlimeProfile.model_validate(stored.model_copy(update=updates).model_dump(mode="json"))
    except ValidationError as e:
        return False, f"validation_error:{e}"

    merged_stored = merged_stored.model_copy(update={"updated_at": _utc_now()})
    save_user_profile(existing.model_copy(update={"slime_profile": merged_stored}), settings=settings)
    return True, ""
