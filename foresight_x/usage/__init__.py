"""Slime Credits usage tracking and enforcement."""

from foresight_x.usage.credits import (
    check_credits,
    consume_credits,
    credit_cost_for_feature,
    get_credit_balance,
    get_or_create_user_credits,
    is_unlimited_user,
    redeem_test_code,
    redeem_voucher_code,
    refund_for_transaction,
)

__all__ = [
    "check_credits",
    "consume_credits",
    "credit_cost_for_feature",
    "get_credit_balance",
    "get_or_create_user_credits",
    "is_unlimited_user",
    "redeem_test_code",
    "redeem_voucher_code",
    "refund_for_transaction",
]

# Alias for spec readers
refund_credits = refund_for_transaction
