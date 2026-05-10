"""Supabase client helpers for admin and user-scoped access."""

from __future__ import annotations

from typing import TYPE_CHECKING

from foresight_x.config import load_settings

if TYPE_CHECKING:
    from supabase import Client


def _require_supabase():
    """Import supabase lazily so pytest/API imports succeed without the optional stack."""
    try:
        from supabase import create_client  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError(
            "Missing optional dependency 'supabase'. Install with: pip install 'foresight-x[web]'"
        ) from e
    return create_client


def get_supabase_admin() -> Client:
    """Service-role client (backend only; bypasses RLS)."""
    create_client = _require_supabase()
    settings = load_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_for_user(user_jwt: str) -> Client:
    """User-scoped client that respects RLS policies."""
    create_client = _require_supabase()
    settings = load_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_ANON_KEY")
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(user_jwt)
    return client
