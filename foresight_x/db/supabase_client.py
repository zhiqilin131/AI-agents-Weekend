"""Supabase client helpers for admin and user-scoped access."""

from __future__ import annotations

from supabase import Client, create_client

from foresight_x.config import load_settings


def get_supabase_admin() -> Client:
    """Service-role client (backend only; bypasses RLS)."""
    settings = load_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_for_user(user_jwt: str) -> Client:
    """User-scoped client that respects RLS policies."""
    settings = load_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_ANON_KEY")
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(user_jwt)
    return client

