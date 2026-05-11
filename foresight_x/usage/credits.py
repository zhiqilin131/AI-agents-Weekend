"""Slime Credits business logic."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from foresight_x.auth import get_supabase_user_for_request
from foresight_x.config import Settings, load_settings
from foresight_x.usage.credit_store import (
    acquire_user_lock,
    append_ledger,
    find_usage_by_request_id,
    load_redemptions,
    load_recent_transactions,
    load_user_credits_row,
    save_redemptions,
    save_user_credits_row,
)
from foresight_x.schemas import UserProfile
from foresight_x.usage.schemas import (
    CreditCheckResult,
    CreditCostBreakdown,
    CreditFeature,
    CreditRedemption,
    CreditTransaction,
    UserCredits,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def hash_normalized_code(code: str) -> tuple[str, str]:
    """Return (hash_hex, normalized_display_token) — normalized is trimmed lower for stable hashing."""
    normalized = " ".join((code or "").strip().lower().split())
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return digest, normalized


def _parse_csv_ids(raw: str) -> set[str]:
    return {x.strip() for x in (raw or "").split(",") if x.strip()}


def is_admin_user(user_id: str, user_email: str | None, settings: Settings | None = None) -> bool:
    s = settings or load_settings()
    uid = (user_id or "").strip()
    emails = _parse_csv_ids(s.admin_emails)
    email_l = (user_email or "").strip().lower()
    if email_l and email_l in {e.lower() for e in emails}:
        return True
    bags = (
        _parse_csv_ids(s.admin_user_ids)
        | _parse_csv_ids(s.admin_local_user_ids)
        | _parse_csv_ids(s.admin_unlimited_user_ids)
    )
    return uid in bags


def is_unlimited_user(user_id: str, user_email: str | None = None, settings: Settings | None = None) -> bool:
    s = settings or load_settings()
    if not s.enable_admin_unlimited:
        return False
    return is_admin_user(user_id, user_email, settings=s)


def credit_cost_for_feature(feature: CreditFeature, settings: Settings | None = None) -> int:
    s = settings or load_settings()
    key = str(feature)
    mapping: dict[str, int] = {
        "shadow_chat": s.credit_cost_shadow_chat,
        "slime_chat": s.credit_cost_slime_chat,
        "slime_voice": s.credit_cost_slime_voice,
        "decision_report": s.credit_cost_decision_report,
        "diary_generate": s.credit_cost_diary_generate,
        "memory_import": s.credit_cost_memory_import,
        "calendar_agent": s.credit_cost_calendar_agent,
        "resource_search": s.credit_cost_resource_search,
        "report_revision": s.credit_cost_report_revision,
        "task_decomposition": s.credit_cost_task_decomposition,
        "outcome_reflection": s.credit_cost_outcome_reflection,
        "tts": s.credit_cost_tts,
        "asr": s.credit_cost_asr,
        "voucher": 0,
        "unknown": 1,
    }
    return max(0, int(mapping.get(key, 1)))


def calculate_credit_cost(
    feature: CreditFeature,
    model_option_id: str | None,
    *,
    settings: Settings | None = None,
    profile: UserProfile | None = None,
) -> CreditCostBreakdown:
    """``ceil(base_cost * model.credit_multiplier)`` using server-resolved model only."""
    import math

    from foresight_x.llm.model_resolve import get_model_option_for_request

    s = settings or load_settings()
    base = credit_cost_for_feature(feature, settings=s)
    opt = get_model_option_for_request(s, str(feature), model_option_id, profile=profile)
    mult = float(opt.credit_multiplier or 1.0)
    final = max(0, int(math.ceil(max(0, base) * max(0.1, mult))))
    return CreditCostBreakdown(
        feature=str(feature),
        base_cost=base,
        model_option_id=opt.id,
        model_display_name=opt.display_name,
        model_multiplier=mult,
        final_cost=final,
    )


def get_or_create_user_credits(user_id: str, settings: Settings | None = None) -> UserCredits:
    s = settings or load_settings()
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("user_id required")
    lock = acquire_user_lock(uid)
    with lock:
        existing = load_user_credits_row(uid, settings=s)
        if existing:
            return existing
        now = _utc_now()
        grant = max(0, int(s.default_slime_credits))
        row = UserCredits(
            user_id=uid,
            balance=grant,
            lifetime_granted=grant,
            lifetime_used=0,
            created_at=now,
            updated_at=now,
        )
        save_user_credits_row(row, settings=s)
        if grant > 0:
            append_ledger(
                CreditTransaction(
                    id=f"tx-{uuid.uuid4().hex}",
                    user_id=uid,
                    type="initial_grant",
                    amount=grant,
                    balance_after=grant,
                    reason="New user initial Slime Credits",
                    feature="unknown",
                    request_id=None,
                    metadata={"source": "get_or_create_user_credits"},
                    created_at=now,
                ),
                settings=s,
            )
        return row


def get_credit_balance(user_id: str, settings: Settings | None = None) -> int:
    row = get_or_create_user_credits(user_id, settings=settings)
    return int(row.balance)


def check_credits(
    user_id: str,
    feature: CreditFeature,
    estimated_cost: int,
    *,
    user_email: str | None = None,
    settings: Settings | None = None,
) -> CreditCheckResult:
    s = settings or load_settings()
    cost = max(0, int(estimated_cost))
    if not s.enable_credit_limits:
        bal = get_credit_balance(user_id, settings=s)
        return CreditCheckResult(allowed=True, balance=bal, required=cost, reason="limits_disabled")
    if is_unlimited_user(user_id, user_email, settings=s):
        return CreditCheckResult(allowed=True, balance=None, required=cost, reason="unlimited_admin")
    row = get_or_create_user_credits(user_id, settings=s)
    if row.balance >= cost:
        return CreditCheckResult(allowed=True, balance=row.balance, required=cost, reason="ok")
    return CreditCheckResult(
        allowed=False,
        balance=row.balance,
        required=cost,
        reason="insufficient_credits",
    )


def log_admin_usage(
    user_id: str,
    feature: CreditFeature,
    would_have_cost: int,
    request_id: str | None,
    settings: Settings | None = None,
    *,
    metadata: dict | None = None,
) -> None:
    s = settings or load_settings()
    uid = (user_id or "").strip()
    row = load_user_credits_row(uid, settings=s) or get_or_create_user_credits(uid, settings=s)
    now = _utc_now()
    meta: dict = {"unlimited": True, "would_have_cost": would_have_cost}
    if metadata:
        meta.update(metadata)
    append_ledger(
        CreditTransaction(
            id=f"tx-{uuid.uuid4().hex}",
            user_id=uid,
            type="admin_usage",
            amount=0,
            balance_after=row.balance,
            reason="Unlimited admin usage (not charged)",
            feature=feature,
            request_id=(request_id or "").strip() or None,
            metadata=meta,
            created_at=now,
        ),
        settings=s,
    )


def consume_credits(
    user_id: str,
    feature: CreditFeature,
    cost: int,
    request_id: str | None,
    metadata: dict | None = None,
    *,
    user_email: str | None = None,
    settings: Settings | None = None,
) -> CreditTransaction | None:
    """Debit credits; returns transaction or None when unlimited / limits off / zero cost. Idempotent on request_id."""
    s = settings or load_settings()
    uid = (user_id or "").strip()
    rid = (request_id or "").strip() or None
    cost_i = max(0, int(cost))
    meta = dict(metadata or {})

    if not s.enable_credit_limits:
        return None
    if is_unlimited_user(uid, user_email, settings=s):
        log_admin_usage(uid, feature, cost_i, rid, settings=s, metadata=meta)
        return None
    if cost_i <= 0:
        return None

    lock = acquire_user_lock(uid)
    with lock:
        if rid:
            prior = find_usage_by_request_id(uid, rid, settings=s)
            if prior is not None:
                return prior
        row = load_user_credits_row(uid, settings=s) or get_or_create_user_credits(uid, settings=s)
        if row.balance < cost_i:
            raise RuntimeError("insufficient_credits")
        new_bal = row.balance - cost_i
        now = _utc_now()
        updated = row.model_copy(
            update={
                "balance": new_bal,
                "lifetime_used": row.lifetime_used + cost_i,
                "updated_at": now,
            }
        )
        save_user_credits_row(updated, settings=s)
        tx = CreditTransaction(
            id=f"tx-{uuid.uuid4().hex}",
            user_id=uid,
            type="usage",
            amount=-cost_i,
            balance_after=new_bal,
            reason=f"Usage: {feature}",
            feature=feature,
            request_id=rid,
            metadata=meta,
            created_at=now,
        )
        append_ledger(tx, settings=s)
        return tx


def refund_for_transaction(original: CreditTransaction, reason: str, settings: Settings | None = None) -> CreditTransaction | None:
    """Refund the absolute usage amount from an earlier usage row."""
    s = settings or load_settings()
    if original.type != "usage" or original.amount >= 0:
        return None
    amt = -int(original.amount)
    if amt <= 0:
        return None
    uid = original.user_id
    lock = acquire_user_lock(uid)
    with lock:
        row = load_user_credits_row(uid, settings=s)
        if row is None:
            return None
        now = _utc_now()
        new_bal = row.balance + amt
        updated = row.model_copy(
            update={
                "balance": new_bal,
                "lifetime_used": max(0, row.lifetime_used - amt),
                "updated_at": now,
            }
        )
        save_user_credits_row(updated, settings=s)
        tx = CreditTransaction(
            id=f"tx-{uuid.uuid4().hex}",
            user_id=uid,
            type="refund",
            amount=amt,
            balance_after=new_bal,
            reason=reason,
            feature=original.feature,
            request_id=original.request_id,
            metadata={"refunded_tx": original.id},
            created_at=now,
        )
        append_ledger(tx, settings=s)
        return tx


def redeem_test_code(user_id: str, code: str, settings: Settings | None = None) -> dict:
    s = settings or load_settings()
    uid = (user_id or "").strip()
    configured = (s.slime_test_code or "").strip()
    reward = max(0, int(s.test_code_reward_credits))
    if not configured:
        return {"ok": False, "error": "invalid_code", "message": "That testing code doesn’t look right."}
    code_hash, normalized = hash_normalized_code(code)
    cfg_hash, cfg_norm = hash_normalized_code(configured)
    if not normalized or code_hash != cfg_hash:
        return {"ok": False, "error": "invalid_code", "message": "That testing code doesn’t look right."}

    label = "configured_test_code"
    lock = acquire_user_lock(uid)
    with lock:
        reds = load_redemptions(uid, settings=s)
        row = load_user_credits_row(uid, settings=s) or get_or_create_user_credits(uid, settings=s)
        now = _utc_now()
        new_bal = row.balance + reward
        updated = row.model_copy(
            update={
                "balance": new_bal,
                "lifetime_granted": row.lifetime_granted + reward,
                "updated_at": now,
            }
        )
        save_user_credits_row(updated, settings=s)
        redemption = CreditRedemption(
            id=f"rd-{uuid.uuid4().hex}",
            user_id=uid,
            code_hash=code_hash,
            code_label=label,
            credits_granted=reward,
            redeemed_at=now,
            metadata={"kind": "test_code"},
        )
        reds.append(redemption)
        save_redemptions(uid, reds, settings=s)
        append_ledger(
            CreditTransaction(
                id=f"tx-{uuid.uuid4().hex}",
                user_id=uid,
                type="redeem_code",
                amount=reward,
                balance_after=new_bal,
                reason="Testing access code redeemed",
                feature="voucher",
                metadata={"code_label": label},
                created_at=now,
            ),
            settings=s,
        )
    _ = cfg_norm
    return {
        "ok": True,
        "credits_granted": reward,
        "balance": new_bal,
        "message": f"Code redeemed. You received {reward} Slime Credits.",
    }


def redeem_voucher_code(user_id: str, code: str, settings: Settings | None = None) -> dict:
    s = settings or load_settings()
    uid = (user_id or "").strip()
    if not s.slime_voucher_enabled:
        return {"ok": False, "error": "voucher_disabled", "message": "Voucher redemption is turned off right now."}
    configured = (s.slime_voucher_code or "").strip()
    reward = max(0, int(s.slime_voucher_reward_credits))
    max_per_user = max(1, int(s.slime_voucher_max_redemptions_per_user))
    if not configured or reward <= 0:
        return {"ok": False, "error": "invalid_code", "message": "That voucher code doesn’t look right."}

    code_hash, normalized = hash_normalized_code(code)
    cfg_hash, _cfg_norm = hash_normalized_code(configured)
    if not normalized or code_hash != cfg_hash:
        return {"ok": False, "error": "invalid_code", "message": "That voucher code doesn’t look right."}

    label = "default_beta_voucher"
    lock = acquire_user_lock(uid)
    with lock:
        reds = load_redemptions(uid, settings=s)
        matches = [r for r in reds if r.code_hash == code_hash]
        if len(matches) >= max_per_user:
            return {"ok": False, "error": "already_redeemed", "message": "You already used this voucher."}
        row = load_user_credits_row(uid, settings=s) or get_or_create_user_credits(uid, settings=s)
        now = _utc_now()
        new_bal = row.balance + reward
        updated = row.model_copy(
            update={
                "balance": new_bal,
                "lifetime_granted": row.lifetime_granted + reward,
                "updated_at": now,
            }
        )
        save_user_credits_row(updated, settings=s)
        redemption = CreditRedemption(
            id=f"rd-{uuid.uuid4().hex}",
            user_id=uid,
            code_hash=code_hash,
            code_label=label,
            credits_granted=reward,
            redeemed_at=now,
            metadata={"kind": "voucher"},
        )
        reds.append(redemption)
        save_redemptions(uid, reds, settings=s)
        append_ledger(
            CreditTransaction(
                id=f"tx-{uuid.uuid4().hex}",
                user_id=uid,
                type="redeem_voucher",
                amount=reward,
                balance_after=new_bal,
                reason="Voucher code redeemed",
                feature="voucher",
                metadata={"code_label": label, "code_hash": code_hash},
                created_at=now,
            ),
            settings=s,
        )
    return {
        "ok": True,
        "credits_granted": reward,
        "balance": new_bal,
        "message": f"Voucher redeemed. You received {reward} Slime Credits.",
    }


def list_transactions_json(user_id: str, limit: int, settings: Settings | None = None) -> list[dict]:
    rows = load_recent_transactions(user_id, limit=min(max(limit, 1), 200), settings=settings)
    return [r.model_dump(mode="json") for r in rows]


def credits_api_payload(user_id: str, settings: Settings | None = None) -> dict:
    s = settings or load_settings()
    ctx = get_supabase_user_for_request()
    email = str(ctx.get("email") or "").strip() if isinstance(ctx, dict) else None
    unlimited = is_unlimited_user(user_id, email or None, settings=s)
    admin = is_admin_user(user_id, email or None, settings=s)
    row = get_or_create_user_credits(user_id, settings=s)
    limits_on = bool(s.enable_credit_limits)
    if unlimited:
        return {
            "balance": None,
            "lifetime_granted": row.lifetime_granted,
            "lifetime_used": row.lifetime_used,
            "limits_enabled": limits_on,
            "is_admin": admin,
            "is_unlimited": True,
            "display_balance": "∞",
        }
    return {
        "balance": row.balance,
        "lifetime_granted": row.lifetime_granted,
        "lifetime_used": row.lifetime_used,
        "limits_enabled": limits_on,
        "is_admin": admin,
        "is_unlimited": False,
        "display_balance": row.balance,
    }
