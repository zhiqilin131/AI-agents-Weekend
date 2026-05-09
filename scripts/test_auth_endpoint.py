"""Smoke test for local /api/me endpoint using a Supabase access token."""

from __future__ import annotations

import httpx

from create_test_user import TEST_USER_EMAIL, get_access_token

API_ME_URL = "http://127.0.0.1:8765/api/me"


def main() -> int:
    token = get_access_token()
    resp = httpx.get(
        API_ME_URL,
        headers={"Authorization": f"Bearer {token}"},
        timeout=10.0,
    )
    if resp.status_code != 200:
        print("❌ /api/me failed")
        print(f"status: {resp.status_code}")
        print(f"body: {resp.text}")
        return 1
    data = resp.json()
    if "id" not in data or "email" not in data:
        print("❌ /api/me response missing required fields")
        print(f"body: {resp.text}")
        return 1
    print("✅ 200 OK")
    print(f"id: {data.get('id')}")
    print(f"email: {data.get('email')}")
    if str(data.get("email") or "").lower() != TEST_USER_EMAIL.lower():
        print(f"⚠️ expected email {TEST_USER_EMAIL}, got {data.get('email')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

