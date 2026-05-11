"""Load/save ``UserProfile`` with Supabase-first persistence and local JSON fallback.

Primary store:
- Supabase table ``profiles`` column ``profile_data`` (jsonb), keyed by ``id = foresight_user_id``.

Fallback store (local/dev only):
- Local file ``data/profile/{FORESIGHT_USER_ID}.json`` when Supabase is unavailable
  or Supabase operation fails outside production.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from foresight_x.config import Settings, load_settings
from foresight_x.db.supabase_client import get_client
from foresight_x.profile.merge import normalize_profile_ids
from foresight_x.schemas import UserProfile

_log = logging.getLogger(__name__)

_IS_PRODUCTION = (
    os.environ.get("VERCEL") == "1"
    or os.environ.get("FORESIGHT_ENV") == "production"
)


def profile_path(settings: Settings | None = None) -> Path:
    s = settings or load_settings()
    return s.profile_dir / f"{s.foresight_user_id}.json"


def _supabase_enabled(settings: Settings) -> bool:
    return (
        bool((settings.supabase_url or "").strip())
        and bool((settings.supabase_service_role_key or "").strip())
    )


def _warn_fallback(reason: str, *, user_id: str, exc: Exception | None = None) -> None:
    if exc is None:
        _log.warning(
            "profile.store fallback to local JSON: reason=%s user_id=%s",
            reason,
            user_id,
        )
        return
    _log.warning(
        "profile.store fallback to local JSON: reason=%s user_id=%s err=%s",
        reason,
        user_id,
        exc,
    )


def _handle_supabase_failure(op: str, user_id: str, exc: Exception):
    if _IS_PRODUCTION:
        _log.error(
            "supabase %s failed in production, refusing fallback: user_id=%s err=%s",
            op,
            user_id,
            exc,
        )
        raise exc
    _warn_fallback(op, user_id=user_id, exc=exc)


def _local_load_user_profile(settings: Settings | None = None) -> UserProfile:
    path = profile_path(settings)
    if not path.is_file():
        return UserProfile()
    raw = UserProfile.model_validate_json(path.read_text(encoding="utf-8"))
    fixed, changed = normalize_profile_ids(raw)
    if changed:
        _local_save_user_profile(fixed, settings=settings)
    return fixed


def _local_save_user_profile(profile: UserProfile, settings: Settings | None = None) -> Path:
    s = settings or load_settings()
    s.profile_dir.mkdir(parents=True, exist_ok=True)
    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    stated = profile.stated_priority_lines()
    profile = profile.model_copy(update={"user_priorities": stated, "priorities": stated})
    path = profile_path(s)
    path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_user_profile(settings: Settings | None = None) -> UserProfile:
    s = settings or load_settings()
    uid = (s.foresight_user_id or "").strip() or "demo_user"

    if not _supabase_enabled(s):
        _warn_fallback("supabase_not_fully_configured", user_id=uid)
        return _local_load_user_profile(settings=s)

    try:
        client = get_client()
        resp = (
            client.table("profiles")
            .select("profile_data")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
        rows = resp.data if isinstance(resp.data, list) else []
        if not rows:
            return UserProfile()

        raw_profile = rows[0].get("profile_data")
        if raw_profile is None:
            return UserProfile()

        if isinstance(raw_profile, str):
            try:
                raw_profile = json.loads(raw_profile)
            except Exception:
                raw_profile = {}

        if not isinstance(raw_profile, dict):
            raw_profile = {}

        parsed = UserProfile.model_validate(raw_profile)
        fixed, changed = normalize_profile_ids(parsed)
        if changed:
            save_user_profile(fixed, settings=s)
        return fixed
    except Exception as exc:
        _handle_supabase_failure("load_user_profile", uid, exc)
        return _local_load_user_profile(settings=s)


def save_user_profile(profile: UserProfile, settings: Settings | None = None) -> Path:
    s = settings or load_settings()
    uid = (s.foresight_user_id or "").strip() or "demo_user"

    profile = UserProfile.model_validate(profile.model_dump(mode="json"))
    stated = profile.stated_priority_lines()
    profile = profile.model_copy(update={"user_priorities": stated, "priorities": stated})
    payload_profile = profile.model_dump(mode="json")

    if not _supabase_enabled(s):
        _warn_fallback("supabase_not_fully_configured", user_id=uid)
        return _local_save_user_profile(profile, settings=s)

    try:
        client = get_client()
        row = {
            "id": uid,
            "profile_data": payload_profile,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        client.table("profiles").upsert(row, on_conflict="id").execute()
        return profile_path(s)
    except Exception as exc:
        _handle_supabase_failure("save_user_profile", uid, exc)
        return _local_save_user_profile(profile, settings=s)
