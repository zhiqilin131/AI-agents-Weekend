"""Slime Credits core logic tests."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from foresight_x.config import Settings
from foresight_x.usage.credit_store import credits_path, ledger_path
from foresight_x.usage.credits import (
    check_credits,
    consume_credits,
    get_credit_balance,
    get_or_create_user_credits,
    redeem_test_code,
    redeem_voucher_code,
    refund_for_transaction,
)


@pytest.fixture()
def isolated_settings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Settings:
    base = Settings(
        foresight_data_dir=tmp_path,
        chroma_persist_dir=tmp_path / "chroma",
        enable_credit_limits=True,
        default_slime_credits=15,
        slime_test_code="beta-test-phrase",
        test_code_reward_credits=100,
        slime_voucher_enabled=True,
        slime_voucher_code="foresight-beta",
        slime_voucher_reward_credits=15,
        enable_admin_unlimited=True,
        admin_user_ids="admin-one",
    )
    monkeypatch.setattr("foresight_x.usage.credits.load_settings", lambda: base)
    monkeypatch.setattr("foresight_x.usage.credit_store.load_settings", lambda: base)
    return base


def test_initial_grant_once(isolated_settings: Settings) -> None:
    u = "user-a"
    a = get_or_create_user_credits(u, settings=isolated_settings)
    b = get_or_create_user_credits(u, settings=isolated_settings)
    assert a.balance == 15
    assert b.balance == 15
    assert credits_path(u, settings=isolated_settings).is_file()


def test_consume_and_insufficient(isolated_settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "foresight_x.usage.credits.get_supabase_user_for_request",
        lambda: {"id": "x", "email": "u@example.com"},
    )
    u = "user-b"
    get_or_create_user_credits(u, settings=isolated_settings)
    chk = check_credits(u, "shadow_chat", 1, user_email="u@example.com", settings=isolated_settings)
    assert chk.allowed is True
    tx = consume_credits(u, "shadow_chat", 1, "req-1", settings=isolated_settings)
    assert tx is not None
    assert tx.amount == -1
    assert get_credit_balance(u, settings=isolated_settings) == 14
    chk2 = check_credits(u, "decision_report", 999, user_email="u@example.com", settings=isolated_settings)
    assert chk2.allowed is False


def test_redeem_test_code_repeatable(isolated_settings: Settings) -> None:
    u = "user-c"
    get_or_create_user_credits(u, settings=isolated_settings)
    r1 = redeem_test_code(u, "  Beta-TEST-phrase  ", settings=isolated_settings)
    assert r1["ok"] is True
    assert r1["credits_granted"] == 100
    assert r1["balance"] == 115
    r2 = redeem_test_code(u, "beta-test-phrase", settings=isolated_settings)
    assert r2["ok"] is True
    assert r2["credits_granted"] == 100
    assert r2["balance"] == 215


def test_voucher_redeem(isolated_settings: Settings) -> None:
    u = "user-d"
    get_or_create_user_credits(u, settings=isolated_settings)
    r1 = redeem_voucher_code(u, "FORESIGHT-BETA", settings=isolated_settings)
    assert r1["ok"] is True
    r2 = redeem_voucher_code(u, "foresight-beta", settings=isolated_settings)
    assert r2["ok"] is False


def test_admin_unlimited_no_charge(isolated_settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "foresight_x.usage.credits.get_supabase_user_for_request",
        lambda: {"id": "admin-one", "email": None},
    )
    u = "admin-one"
    get_or_create_user_credits(u, settings=isolated_settings)
    consume_credits(u, "shadow_chat", 9999, "x1", settings=isolated_settings)
    # Unlimited: consume returns None (no debit)
    bal = get_credit_balance(u, settings=isolated_settings)
    assert bal == 15


def test_refund_restores_balance(isolated_settings: Settings) -> None:
    u = "user-e"
    get_or_create_user_credits(u, settings=isolated_settings)
    tx = consume_credits(u, "diary_generate", 2, "r2", settings=isolated_settings)
    assert tx is not None
    before = get_credit_balance(u, settings=isolated_settings)
    refund_for_transaction(tx, "test refund", settings=isolated_settings)
    after = get_credit_balance(u, settings=isolated_settings)
    assert after == before + 2


def test_limits_disabled_allows_without_consume(isolated_settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    s = isolated_settings.model_copy(update={"enable_credit_limits": False})
    monkeypatch.setattr("foresight_x.usage.credits.load_settings", lambda: s)
    monkeypatch.setattr("foresight_x.usage.credit_store.load_settings", lambda: s)
    u = "user-f"
    chk = check_credits(u, "shadow_chat", 99999, settings=s)
    assert chk.allowed is True
    assert chk.reason == "limits_disabled"
    c = consume_credits(u, "shadow_chat", 1, "z", settings=s)
    assert c is None
