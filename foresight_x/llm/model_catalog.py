"""Central catalog of user-selectable OpenAI chat models (Slime model tiers).

``provider_model`` comes only from server env (see :class:`foresight_x.config.Settings`).
Missing env entries disable that tier without crashing the app.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings

ProviderName = Literal["openai"]
TierName = Literal["lite", "cheap", "balanced", "premium", "research", "legendary"]
SpeedName = Literal["fast", "medium", "slow"]
QualityName = Literal["basic", "good", "high", "highest"]


class ModelOption(BaseModel):
    """One selectable product model (user sees ``id`` + marketing fields)."""

    id: str = Field(min_length=1, max_length=64, description="Stable product id, e.g. swift / balanced / deep.")
    provider: ProviderName = "openai"
    provider_model: str = Field(min_length=1, description="OpenAI model name passed to the API.")
    display_name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    best_for: list[str] = Field(default_factory=list)
    tier: TierName = "balanced"
    speed: SpeedName = "medium"
    quality: QualityName = "good"
    credit_multiplier: float = Field(default=1.0, ge=0.1, le=100.0)
    enabled: bool = True
    default_for_features: list[str] = Field(default_factory=list)
    max_output_tokens: int | None = Field(default=None, ge=256, le=128_000)
    supports_tools: bool = True
    supports_vision: bool = False
    supports_audio: bool = False
    notes: str = ""


def _tpl(
    *,
    id: str,
    display_name: str,
    description: str,
    best_for: list[str],
    tier: TierName,
    speed: SpeedName,
    quality: QualityName,
    default_feats: list[str],
    mult: float,
    provider_model: str,
    supports_vision: bool = False,
    supports_audio: bool = False,
) -> dict[str, Any]:
    return {
        "id": id,
        "provider": "openai",
        "provider_model": provider_model,
        "display_name": display_name,
        "description": description,
        "best_for": best_for,
        "tier": tier,
        "speed": speed,
        "quality": quality,
        "credit_multiplier": mult,
        "default_for_features": default_feats,
        "supports_tools": True,
        "supports_vision": supports_vision,
        "supports_audio": supports_audio,
    }


def build_model_catalog(settings: Settings) -> list[ModelOption]:
    """Build catalog from settings; omit or disable rows without a configured ``provider_model``."""
    s = settings
    little_model = (s.openai_model_little or "").strip()
    swift_model = (s.openai_model_swift or "").strip() or (s.openai_model or "").strip()
    balanced_model = (s.openai_model_balanced or "").strip()
    deep_model = (s.openai_model_deep or "").strip()
    research_model = (s.openai_model_research or "").strip()
    slime_55_model = (s.openai_model_slime_55 or "").strip()

    rows: list[dict[str, Any]] = []

    if little_model:
        rows.append(
            _tpl(
                id="little",
                display_name="Little Slime",
                description=(
                    "Bankrupt-edition tier: smallest credit use, good enough for quick pings and "
                    "very simple questions. Uses a compact model."
                ),
                best_for=["Tight credits", "One-line questions", "Smoke tests"],
                tier="lite",
                speed="fast",
                quality="basic",
                default_feats=[],
                mult=float(s.model_little_multiplier or 0.35),
                provider_model=little_model,
            )
        )

    if swift_model:
        rows.append(
            _tpl(
                id="swift",
                display_name="Swift Slime",
                description=(
                    "Fast and credit-friendly. Best for casual chat, simple memory recall, "
                    "and quick calendar-style commands."
                ),
                best_for=["Casual chat", "Simple memory recall", "Calendar commands", "Voice routing"],
                tier="cheap",
                speed="fast",
                quality="good",
                default_feats=["shadow_chat", "slime_chat", "slime_voice", "calendar_agent", "tts", "asr"],
                mult=float(s.model_swift_multiplier or 2.25),
                provider_model=swift_model,
            )
        )

    if balanced_model:
        rows.append(
            _tpl(
                id="balanced",
                display_name="Balanced Slime",
                description=(
                    "Good default for everyday decisions, memory synthesis, and planning "
                    "when you want a bit more depth than Swift."
                ),
                best_for=["Decision support", "Memory synthesis", "Planning", "Diary generation"],
                tier="balanced",
                speed="medium",
                quality="high",
                default_feats=["decision_report", "memory_import", "resource_search", "diary_generate"],
                mult=float(s.model_balanced_multiplier or 5.0),
                provider_model=balanced_model,
                supports_vision=True,
            )
        )

    if deep_model:
        rows.append(
            _tpl(
                id="deep",
                display_name="Deep Slime",
                description=(
                    "Slower and more credit-heavy. Use for complex or high-stakes decisions "
                    "and long report-style revision when quality matters more than speed."
                ),
                best_for=["Career decisions", "Academic decisions", "Long report revision"],
                tier="premium",
                speed="slow",
                quality="highest",
                default_feats=[],
                mult=float(s.model_deep_multiplier or 12.0),
                provider_model=deep_model,
                supports_vision=True,
            )
        )

    if slime_55_model:
        rows.append(
            _tpl(
                id="slime_55",
                display_name="5.5",
                description=(
                    "Legendary Slime tier — unlocked from Profile. Not for the faint of credits."
                ),
                best_for=["Bob", "Andrew", "Peak performance", "Maximum slime energy"],
                tier="legendary",
                speed="fast",
                quality="highest",
                default_feats=[],
                mult=float(s.model_slime_55_multiplier or 15.0),
                provider_model=slime_55_model,
                supports_vision=True,
            )
        )

    if research_model:
        rows.append(
            _tpl(
                id="research",
                display_name="Research Slime",
                description="Best for source-heavy synthesis and careful comparisons. Highest credit use.",
                best_for=["Resource synthesis", "Evidence-heavy questions"],
                tier="research",
                speed="slow",
                quality="highest",
                default_feats=["resource_search"],
                mult=float(s.model_research_multiplier or 22.0),
                provider_model=research_model,
                supports_vision=True,
            )
        )

    return [ModelOption.model_validate(r) for r in rows]
