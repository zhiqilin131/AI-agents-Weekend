"""Pydantic models for Slime Credits."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

CreditFeature = Literal[
    "slime_chat",
    "slime_voice",
    "shadow_chat",
    "decision_report",
    "diary_generate",
    "memory_import",
    "calendar_agent",
    "resource_search",
    "tts",
    "asr",
    "voucher",
    "unknown",
]

CreditTransactionType = Literal[
    "initial_grant",
    "redeem_code",
    "redeem_voucher",
    "usage",
    "refund",
    "admin_adjustment",
    "admin_usage",
]


class UserCredits(BaseModel):
    user_id: str
    balance: int = Field(ge=0)
    lifetime_granted: int = Field(ge=0)
    lifetime_used: int = Field(ge=0)
    created_at: str
    updated_at: str


class CreditTransaction(BaseModel):
    id: str
    user_id: str
    type: CreditTransactionType
    amount: int
    balance_after: int | None = None
    reason: str
    feature: CreditFeature = "unknown"
    request_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class CreditRedemption(BaseModel):
    id: str
    user_id: str
    code_hash: str
    code_label: str | None = None
    credits_granted: int = Field(ge=0)
    redeemed_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreditCheckResult(BaseModel):
    allowed: bool
    balance: int | None
    required: int
    reason: Literal["ok", "insufficient_credits", "unlimited_user", "limits_disabled", "unlimited_admin"]
