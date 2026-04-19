"""User profile persistence (shadow self)."""

from foresight_x.profile.merge import merge_profile_into_user_state
from foresight_x.profile.store import load_user_profile, profile_path, save_user_profile

__all__ = [
    "load_user_profile",
    "merge_profile_into_user_state",
    "profile_path",
    "save_user_profile",
]
