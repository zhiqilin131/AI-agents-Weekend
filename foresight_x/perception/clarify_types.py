"""Shared types for clarification gate (avoids import cycles)."""

from __future__ import annotations

from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


class StructuredPredictLLM(Protocol):
    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        ...


class ClarifyOption(BaseModel):
    value: str = Field(description="Stable id for the answer, e.g. learning_first")
    label: str = Field(description="Short human-readable choice")


class ClarifyQuestion(BaseModel):
    id: str = Field(description="snake_case id, e.g. transfer_primary_motive")
    prompt: str = Field(description="One sentence question")
    options: list[ClarifyOption] = Field(min_length=2, max_length=6)


SkipReason = Literal[
    "none",
    "no_input",
    "no_llm",
    "not_needed",
    "no_questions",
    "error",
    "shadow_chat_non_analytical",
]


class ClarifyGateResult(BaseModel):
    need_clarification: bool = Field(
        description="True only when a targeted clarification materially improves analysis."
    )
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    note: str = Field(default="", description="Optional hint for the UI")
    skip_reason: SkipReason = Field(
        default="none",
        description="When need_clarification is false: why the UI gate was not shown.",
    )
    clarification_meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Domain, rationale, target_dimension for 'Why ask this?', tests, and logging.",
    )
