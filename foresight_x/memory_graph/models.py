"""Typed models for temporal graph memory snapshots."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


GraphLayer = Literal["event", "concept"]


class GraphNode(BaseModel):
    node_id: str
    layer: GraphLayer
    node_type: str
    label: str
    created_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    edge_type: str
    weight: float = 1.0
    t_valid: str
    t_invalid: str = ""
    source_episode: str = ""
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GraphSnapshot(BaseModel):
    user_id: str
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    updated_at: str = ""
