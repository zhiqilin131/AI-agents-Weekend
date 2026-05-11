"""Resolve a validated :class:`ModelOption` for a feature + user preference."""

from __future__ import annotations

from typing import Any

from foresight_x.config import Settings, load_settings
from foresight_x.llm.model_catalog import ModelOption, build_model_catalog
from foresight_x.schemas import UserProfile

# When the user (or profile) does not specify a model, default to the cheapest tier (``little`` / gpt-4o-mini).
FEATURE_DEFAULT_MODEL: dict[str, str] = {
    "shadow_chat": "little",
    "slime_chat": "little",
    "slime_voice": "little",
    "decision_report": "little",
    "diary_generate": "little",
    "memory_import": "little",
    "calendar_agent": "little",
    "resource_search": "little",
    "report_revision": "little",
    "task_decomposition": "little",
    "outcome_reflection": "little",
    "tts": "little",
    "asr": "little",
    "voucher": "little",
    "unknown": "little",
}


def _by_id(options: list[ModelOption], mid: str) -> ModelOption | None:
    key = (mid or "").strip().lower()
    for o in options:
        if o.id.lower() == key:
            return o
    return None


def get_model_option_for_request(
    settings: Settings,
    feature: str,
    requested_model_option_id: str | None,
    *,
    profile: UserProfile | None = None,
    need_tools: bool = True,
    need_vision: bool = False,
    need_audio: bool = False,
) -> ModelOption:
    """Resolve model id → :class:`ModelOption` (enabled + capability-checked), with safe fallback."""
    s = settings
    catalog = [m for m in build_model_catalog(s) if m.enabled and (m.provider_model or "").strip()]
    if not catalog:
        # No env-configured tiers: fall back to legacy OPENAI_MODEL as a single implicit swift-like row.
        pm = (s.openai_model or "gpt-4o-mini").strip()
        return ModelOption(
            id="legacy",
            provider="openai",
            provider_model=pm,
            display_name="Default",
            description="Server default chat model (no Slime tier env vars configured).",
            best_for=["General use"],
            tier="balanced",
            speed="medium",
            quality="good",
            credit_multiplier=1.0,
            enabled=True,
            supports_tools=True,
        )

    def _pick(first: str | None) -> ModelOption | None:
        if not first:
            return None
        cand = _by_id(catalog, first)
        if cand is None or not cand.enabled:
            return None
        if need_tools and not cand.supports_tools:
            return None
        if need_vision and not cand.supports_vision:
            return None
        if need_audio and not cand.supports_audio:
            return None
        return cand

    chain: list[str | None] = [
        (requested_model_option_id or "").strip() or None,
        (getattr(profile, "default_model_option_id", None) or "").strip() or None if profile else None,
        FEATURE_DEFAULT_MODEL.get(str(feature), None),
        (s.default_model_option or "").strip() or None,
        catalog[0].id,
    ]

    for raw in chain:
        hit = _pick(raw)
        if hit is not None:
            return hit

    return catalog[0]


def public_model_dict(option: ModelOption) -> dict[str, Any]:
    """Payload for ``GET /api/models`` (no API key). Includes ``engine`` = configured OpenAI model id for UI transparency."""
    badge = {
        "lite": "Lite",
        "cheap": "Fast",
        "balanced": "Balanced",
        "premium": "Deep",
        "research": "Premium",
        "legendary": "5.5",
    }.get(option.tier, "Balanced")
    return {
        "id": option.id,
        "display_name": option.display_name,
        "description": option.description,
        "best_for": list(option.best_for),
        "tier": option.tier,
        "speed": option.speed,
        "quality": option.quality,
        "credit_multiplier": option.credit_multiplier,
        "enabled": option.enabled,
        "badge": badge,
        "supports_tools": option.supports_tools,
        "supports_vision": option.supports_vision,
        "supports_audio": option.supports_audio,
        "engine": (option.provider_model or "").strip(),
    }


def default_model_id_for_catalog(settings: Settings | None = None) -> str:
    s = settings or load_settings()
    cat = build_model_catalog(s)
    enabled = [m for m in cat if m.enabled]
    want = (s.default_model_option or "little").strip().lower()
    for m in enabled:
        if m.id.lower() == want:
            return m.id
    return enabled[0].id if enabled else "legacy"
