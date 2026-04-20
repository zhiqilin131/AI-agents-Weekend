"""Load/save ``UserProfile`` JSON under ``data/profile/{FORESIGHT_USER_ID}.json``."""

from __future__ import annotations

from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.profile.merge import normalize_profile_ids
from foresight_x.schemas import UserProfile


def profile_path(settings: Settings | None = None) -> Path:
    s = settings or load_settings()
    return s.profile_dir / f"{s.foresight_user_id}.json"


def load_user_profile(settings: Settings | None = None) -> UserProfile:
    path = profile_path(settings)
    if not path.is_file():
        return UserProfile()
    raw = UserProfile.model_validate_json(path.read_text(encoding="utf-8"))
    fixed, changed = normalize_profile_ids(raw)
    if changed:
        save_user_profile(fixed, settings=settings)
    return fixed


def save_user_profile(profile: UserProfile, settings: Settings | None = None) -> Path:
    s = settings or load_settings()
    s.profile_dir.mkdir(parents=True, exist_ok=True)
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    stated = profile.stated_priority_lines()
    profile = profile.model_copy(update={"user_priorities": stated, "priorities": stated})
    path = profile_path(s)
    path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")
    return path
