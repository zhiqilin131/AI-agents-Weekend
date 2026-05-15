from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.schemas import UserProfile


SafetyViolation = Literal[
    "not_therapy",
    "no_medical_advice",
    "no_emergency",
    "no_dependency_reinforcement",
]

SafetyRule = Literal[
    "skip_external_resources",
    "suppress_followup",
    "slime_text_safety",
]

PersonaId = Literal["a", "b", "c", "d"]
ScenarioCategory = Literal["decision", "shadow", "cross_session", "mode_routing", "safety"]


class PersonaFixture(UserProfile):
    past_decisions: list[dict[str, Any]] = Field(default_factory=list)


class ScenarioMetadata(BaseModel):
    model_id: str
    llm_call_count_budget: int
    llm_call_count_target: int | None = None


class ExpectedBlock(BaseModel):
    must_retrieve_memory_ids: list[str] = Field(default_factory=list)
    must_include_in_options: list[str] = Field(default_factory=list)
    must_not_violate: list[SafetyViolation] = Field(default_factory=list)
    recommendation_present: bool = True
    latency_p95_ms: int = 10_000
    latency_target_ms: int | None = None
    known_backend_issue: str | None = None
    safety_rules: list[SafetyRule] = Field(default_factory=list)
    safety_assertion_scope: Literal["last_turn", "all_turns"] = "last_turn"


class Scenario(BaseModel):
    id: str
    persona_id: PersonaId
    category: ScenarioCategory
    input: str | list[dict[str, Any]]
    expected: ExpectedBlock
    metadata: ScenarioMetadata
