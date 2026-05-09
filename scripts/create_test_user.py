"""Create/reuse a Supabase test user and print an access token.

This is a local utility for auth smoke tests. Do not commit printed tokens.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from supabase import Client, create_client

from foresight_x.config import load_settings

TEST_USER_EMAIL = "testuser@foresight-x.local"
TEST_USER_PASSWORD = "TestUser2026SecurePass!"
TEST_USER2_EMAIL = "testuser2@foresight-x.local"
TEST_USER2_PASSWORD = "TestUser2_2026SecurePass!"


def _as_dict(obj: Any) -> dict[str, Any]:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if isinstance(obj, dict):
        return obj
    return {}


def _iter_users(payload: Any) -> list[dict[str, Any]]:
    data = _as_dict(payload)
    users = data.get("users")
    if isinstance(users, list):
        out: list[dict[str, Any]] = []
        for u in users:
            if hasattr(u, "model_dump"):
                out.append(u.model_dump())
            elif isinstance(u, dict):
                out.append(u)
        return out
    return []


def _find_user_by_email(admin: Client, email: str) -> dict[str, Any] | None:
    target = email.lower()
    try:
        page = 1
        while True:
            listed = admin.auth.admin.list_users(page=page, per_page=200)
            users = _iter_users(listed)
            if not users:
                break
            for u in users:
                if str(u.get("email") or "").lower() == target:
                    return u
            page += 1
    except Exception:
        return None
    return None


def _ensure_user(admin: Client, email: str, password: str) -> str:
    existing = _find_user_by_email(admin, email)
    if existing and existing.get("id"):
        user_id = str(existing["id"])
        try:
            admin.auth.admin.update_user_by_id(
                user_id,
                {"password": password, "email_confirm": True},
            )
        except Exception:
            # Non-fatal: if password update fails, token request below will report the actual issue.
            pass
        return user_id

    try:
        created = admin.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
            }
        )
    except Exception:
        # Handle race/already-exists style failures by looking up the user and continuing.
        existing = _find_user_by_email(admin, email)
        if existing and existing.get("id"):
            user_id = str(existing["id"])
            try:
                admin.auth.admin.update_user_by_id(
                    user_id,
                    {"password": password, "email_confirm": True},
                )
            except Exception:
                pass
            return user_id
        raise
    created_data = _as_dict(created)
    user = created_data.get("user") if isinstance(created_data.get("user"), dict) else created_data
    user_id = str(user.get("id") or "")
    if not user_id:
        raise RuntimeError("create_user succeeded but no user id returned")
    return user_id


def get_access_token_for_user(email: str, password: str) -> str:
    settings = load_settings()
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is missing")
    if not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is missing")
    if not settings.supabase_anon_key:
        raise RuntimeError("SUPABASE_ANON_KEY is missing")

    token_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token"
    resp = httpx.post(
        token_url,
        params={"grant_type": "password"},
        headers={
            "apikey": settings.supabase_anon_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=15.0,
    )
    if resp.status_code < 400:
        data = resp.json()
        access_token = str(data.get("access_token") or "")
        if access_token:
            return access_token

    admin = create_client(settings.supabase_url, settings.supabase_service_role_key)
    _ensure_user(admin, email, password)
    resp2 = httpx.post(
        token_url,
        params={"grant_type": "password"},
        headers={
            "apikey": settings.supabase_anon_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=15.0,
    )
    if resp2.status_code >= 400:
        raise RuntimeError(f"token exchange failed: {resp2.status_code} {resp2.text}")
    data = resp2.json()
    access_token = str(data.get("access_token") or "")
    if not access_token:
        raise RuntimeError("No access_token in token response")
    return access_token


def get_access_token() -> str:
    return get_access_token_for_user(TEST_USER_EMAIL, TEST_USER_PASSWORD)


def main() -> int:
    token = get_access_token()
    print("TEST_USER_EMAIL=" + TEST_USER_EMAIL)
    print("ACCESS_TOKEN=" + token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

