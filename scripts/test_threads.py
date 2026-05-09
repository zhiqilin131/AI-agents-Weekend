"""Smoke tests for /api/threads including RLS isolation."""

from __future__ import annotations

import httpx

from create_test_user import (
    TEST_USER2_EMAIL,
    TEST_USER2_PASSWORD,
    TEST_USER_EMAIL,
    TEST_USER_PASSWORD,
    get_access_token_for_user,
)

BASE_URL = "http://127.0.0.1:8765"


def _get_threads(token: str) -> list[dict]:
    r = httpx.get(
        f"{BASE_URL}/api/threads",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"GET /api/threads failed: {r.status_code} {r.text}")
    data = r.json()
    return data.get("threads", [])


def _post_thread(token: str, title: str, mode: str) -> tuple[int, str, dict | None]:
    r = httpx.post(
        f"{BASE_URL}/api/threads",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": title, "mode": mode},
        timeout=10.0,
    )
    body_text = r.text
    body_json = None
    try:
        body_json = r.json()
    except Exception:
        pass
    return r.status_code, body_text, body_json


def main() -> int:
    print("a) Acquire token A")
    token_a = get_access_token_for_user(TEST_USER_EMAIL, TEST_USER_PASSWORD)
    print("   ✅ token A ready")

    print("b) Acquire token B")
    token_b = get_access_token_for_user(TEST_USER2_EMAIL, TEST_USER2_PASSWORD)
    print("   ✅ token B ready")

    print("c) GET /api/threads with token A")
    before_a = _get_threads(token_a)
    print(f"   ✅ status 200, count={len(before_a)}")

    print("d) POST /api/threads with token A (title='A\\'s thread', mode='shadow')")
    status_d, text_d, json_d = _post_thread(token_a, "A's thread", "shadow")
    if status_d != 200 or not json_d or "thread" not in json_d:
        print(f"   ❌ expected 200, got {status_d}: {text_d}")
        return 1
    created = json_d["thread"]
    created_id = str(created.get("id") or "")
    print(f"   ✅ created id={created_id}")

    print("e) GET /api/threads with token A contains created thread")
    after_a = _get_threads(token_a)
    if not any(str(t.get("id") or "") == created_id for t in after_a):
        print("   ❌ created thread not found in token A list")
        return 1
    print(f"   ✅ found created thread in token A list (count={len(after_a)})")

    print("f) GET /api/threads with token B does not include A thread (RLS isolation)")
    list_b = _get_threads(token_b)
    if any(str(t.get("id") or "") == created_id for t in list_b):
        print("   ❌ RLS isolation failed: token B can see token A thread")
        return 1
    print(f"   ✅ isolation ok (token B count={len(list_b)}, A thread hidden)")

    print("g) POST invalid mode should return 422")
    status_g, text_g, _ = _post_thread(token_a, "invalid mode test", "invalid")
    if status_g != 422:
        print(f"   ❌ expected 422, got {status_g}: {text_g}")
        return 1
    print("   ✅ got 422 for invalid mode")

    print("All thread tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

