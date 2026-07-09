"""Schemas for the fictional quality benchmark (separate from tests/eval)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.schemas import UserProfile


class GraphMockNode(BaseModel):
    label: str
    score: float = 1.0
    node_id: str = "graphiti:mock"
    node_type: str = "entity"
    why: str = "mock fixture"


class GraphCase(BaseModel):
    """F0 graph relevance case.

    Exercises the REAL production ranking function
    (``foresight_x.orchestration.pipeline._rank_graph_nodes_for_display``)
    against a noisy candidate pool: ``mock_top_nodes`` (genuinely relevant,
    should surface) + ``decoy_nodes`` (irrelevant/blocklisted, deliberately
    given a HIGHER raw score to prove token-overlap tiering — not raw score —
    decides what gets displayed). No API calls.
    """

    id: str
    domain: str
    query: str
    decision_type: str = "personal"
    goals: list[str] = Field(default_factory=list)
    mock_top_nodes: list[GraphMockNode]
    decoy_nodes: list[GraphMockNode] = Field(default_factory=list)
    must_include_any: list[list[str]] = Field(default_factory=list)
    must_exclude: list[str] = Field(default_factory=list)
    min_include_groups_hit: int = 1


class MemoryPrecisionCase(BaseModel):
    """F0 memory precision — keyword checks on retrieved summaries."""

    id: str
    query: str
    top_memory_summaries: list[str]
    must_not_contain: list[str] = Field(default_factory=list)
    must_contain_any: list[str] = Field(default_factory=list)


class QualityExpected(BaseModel):
    must_retrieve_memory_ids: list[str] = Field(default_factory=list)
    min_retrieval_recall: float = Field(default=0.5, ge=0.0, le=1.0)
    must_include_in_options: list[str] = Field(default_factory=list)
    must_not_violate: list[str] = Field(default_factory=list)
    recommendation_present: bool = True
    must_exclude_in_top_memory: list[str] = Field(default_factory=list)
    must_exclude_graph_labels: list[str] = Field(default_factory=list)
    expect_graph_influence: bool = False
    max_elicitation_rounds: int = 2
    min_coverage_after_gate: float | None = None
    latency_p95_ms: int = 120_000
    latency_target_ms: int | None = 10_000
    known_backend_issue: str | None = None
    safety_rules: list[str] = Field(default_factory=list)
    safety_assertion_scope: Literal["last_turn", "all_turns"] = "last_turn"


class QualityMetadata(BaseModel):
    model_id: str = "gpt-4o-mini"
    llm_call_count_budget: int = 32
    llm_call_count_target: int | None = None
    estimated_llm_calls: int | None = None


class QualityE2EScenario(BaseModel):
    id: str
    persona_id: str
    category: Literal["decision", "cross_session", "shadow"] = "decision"
    input: str | list[dict[str, Any]]
    expected: QualityExpected
    metadata: QualityMetadata


class PersonaFixture(UserProfile):
    """Fictional persona for quality E2E seeding — same validation as production UserProfile."""

    past_decisions: list[dict[str, Any]] = Field(default_factory=list)
