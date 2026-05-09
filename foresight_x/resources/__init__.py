"""Post-hoc resource suggestions (Tavily + internal actions) for recommendation UI."""

from foresight_x.resources.resource_drops import (
    INTERNAL_CALENDAR_ID,
    ResourceDrop,
    calendar_fallback_drops,
    generate_resource_drops_for_recommendation,
)
from foresight_x.resources.tavily_resources import build_tavily_resource_queries

__all__ = [
    "INTERNAL_CALENDAR_ID",
    "ResourceDrop",
    "build_tavily_resource_queries",
    "calendar_fallback_drops",
    "generate_resource_drops_for_recommendation",
]
