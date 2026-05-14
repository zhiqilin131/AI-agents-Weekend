from __future__ import annotations

from concurrent.futures import TimeoutError as FuturesTimeout

from foresight_x.config import Settings
from foresight_x.shadow.chat import _collect_atomic_claims_or_empty


class _SlowFuture:
    def result(self, timeout=None):  # type: ignore[no-untyped-def]
        raise FuturesTimeout()


class _OkFuture:
    def result(self, timeout=None):  # type: ignore[no-untyped-def]
        return [{"text": "User likes concise responses."}]


def test_collect_atomic_claims_returns_empty_on_timeout() -> None:
    s = Settings(openai_api_key="", shadow_atomic_claims_timeout_sec=0.2)
    out = _collect_atomic_claims_or_empty(_SlowFuture(), settings=s, last_user_text="hello")
    assert out == []


def test_collect_atomic_claims_returns_values_on_success() -> None:
    s = Settings(openai_api_key="", shadow_atomic_claims_timeout_sec=0.2)
    out = _collect_atomic_claims_or_empty(_OkFuture(), settings=s, last_user_text="hello")
    assert out and out[0]["text"].startswith("User likes")
