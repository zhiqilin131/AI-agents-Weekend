"""
Tier 3 Memory: persistent storage for the semantic user profile.
Stored as JSON on disk, one file per user. Separate from Chroma because profiles
are small, structured, and benefit from human inspection / debugging.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from foresight_x.config import load_settings
from foresight_x.schemas import UserProfile

# Use the repository's configured data root, but keep Tier-3 path separate from
# the existing shadow-profile path (`data/profile`) to match this task's design.
PROFILES_DIR = load_settings().foresight_data_dir / "profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)


def _profile_path(user_id: str) -> Path:
    # Reject anything that could escape the profiles dir.
    if "/" in user_id or ".." in user_id:
        raise ValueError(f"Invalid user_id: {user_id!r}")
    return PROFILES_DIR / f"{user_id}.json"


def load_profile(user_id: str) -> UserProfile | None:
    """Load profile from disk, or None if it doesn't exist yet."""
    path = _profile_path(user_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return UserProfile(**data)
    except (json.JSONDecodeError, Exception) as e:
        # Corrupt profile — log and return None rather than crash.
        print(f"[profile_store] failed to load profile for {user_id}: {e}")
        return None


def save_profile(profile: UserProfile) -> None:
    """Persist profile to disk. Overwrites existing."""
    stamped = profile.model_copy(update={"last_updated": datetime.utcnow().isoformat()})
    path = _profile_path(stamped.user_id)
    path.write_text(
        json.dumps(stamped.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def empty_profile(user_id: str) -> UserProfile:
    """Cold-start default: an empty profile with unknown risk posture."""
    return UserProfile(
        user_id=user_id,
        last_updated=datetime.utcnow().isoformat(),
        confidence=0.0,
    )

