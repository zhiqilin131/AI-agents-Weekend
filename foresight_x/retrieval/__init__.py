"""Retrieval: user memory (Chroma) and world knowledge (cache + Tavily).

Heavy imports (Chroma, LlamaIndex) load only when you access `UserMemory` / `WorldKnowledge`
or import those submodules. Importing `foresight_x.retrieval.tavily_client` stays lightweight.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "TavilyGateway",
    "build_tavily_gateway",
    "UserMemory",
    "WorldKnowledge",
    "ingest_memory_json",
    "ingest_world_markdown",
]


def __getattr__(name: str) -> Any:
    if name == "UserMemory":
        from foresight_x.retrieval.memory import UserMemory

        return UserMemory
    if name == "WorldKnowledge":
        from foresight_x.retrieval.world_cache import WorldKnowledge

        return WorldKnowledge
    if name == "ingest_memory_json":
        from foresight_x.retrieval.seed import ingest_memory_json

        return ingest_memory_json
    if name == "ingest_world_markdown":
        from foresight_x.retrieval.seed import ingest_world_markdown

        return ingest_world_markdown
    if name == "TavilyGateway":
        from foresight_x.retrieval.tavily_client import TavilyGateway

        return TavilyGateway
    if name == "build_tavily_gateway":
        from foresight_x.retrieval.tavily_client import build_tavily_gateway

        return build_tavily_gateway
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
