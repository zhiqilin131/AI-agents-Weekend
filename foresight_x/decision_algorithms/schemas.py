from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DecisionOption(BaseModel):
    id: str
    title: str
    description: str = ""
    assumptions: list[str] = Field(default_factory=list)


class DecisionUncertainty(BaseModel):
    id: str
    name: str
    description: str = ""
    direction: Literal["higher_is_better", "higher_is_worse", "unknown"] = "unknown"


class DecisionValue(BaseModel):
    id: str
    name: str
    weight: float = Field(default=0.1, ge=0.0, le=1.0)
    description: str = ""


class DecisionConstraint(BaseModel):
    id: str
    type: str = "general"
    description: str


class ExecutionTask(BaseModel):
    id: str
    title: str
    duration_minutes: int = Field(ge=15, le=8 * 60)
    description: str = ""
    priority: Literal["low", "medium", "high"] = "medium"
    deadline_hint: str | None = None
    linked_option_id: str | None = None


class DecisionInfluenceGraph(BaseModel):
    decision_question: str
    options: list[DecisionOption] = Field(default_factory=list)
    uncertainties: list[DecisionUncertainty] = Field(default_factory=list)
    values: list[DecisionValue] = Field(default_factory=list)
    constraints: list[DecisionConstraint] = Field(default_factory=list)
    action_candidates: list[ExecutionTask] = Field(default_factory=list)


class DecisionCriterion(BaseModel):
    key: str
    kind: Literal["benefit", "cost"] = "benefit"
    weight: float = Field(default=0.1, ge=0.0, le=1.0)


class RankedOption(BaseModel):
    option_id: str
    rank: int
    score: float
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    dominant_criteria: list[str] = Field(default_factory=list)


class MCDAResult(BaseModel):
    method: str
    ranked_options: list[RankedOption] = Field(default_factory=list)
    criteria_weights: dict[str, float] = Field(default_factory=dict)
    criteria_scores: dict[str, dict[str, float]] = Field(default_factory=dict)
    sensitivity_notes: list[str] = Field(default_factory=list)


class ConsequenceScenario(BaseModel):
    option_id: str
    label: Literal["optimistic", "realistic", "downside", "high_stress", "delayed_progress"]
    consequence_summary: str
    stress_level: Literal["low", "medium", "high"] = "medium"
    workload_pressure: Literal["low", "medium", "high"] = "medium"
    downside_severity: Literal["low", "medium", "high"] = "medium"
    reversibility: Literal["low", "medium", "high"] = "medium"
    regret_risk: Literal["low", "medium", "high"] = "medium"
    recovery_path: str = ""
    early_warning_signals: list[str] = Field(default_factory=list)
    review_checkpoint: str = ""


class RobustnessResult(BaseModel):
    option_id: str
    robustness_label: Literal["robust", "robust_with_monitoring", "fragile", "uncertain"] = "uncertain"
    summary: str
    plausible_paths: list[ConsequenceScenario] = Field(default_factory=list)
    vulnerability_conditions: list[str] = Field(default_factory=list)
    downside_exposure: Literal["low", "medium", "high"] = "medium"
    reversibility: Literal["low", "medium", "high"] = "medium"
    regret_risk: Literal["low", "medium", "high", "low_to_medium", "medium_to_high"] = "medium"
    review_checkpoint: str = ""
    early_warning_signals: list[str] = Field(default_factory=list)
    max_regret_proxy: float = 0.0


class AgilityPreview(BaseModel):
    selected_option_id: str
    headline: str
    summary: str
    likely_consequences: list[str] = Field(default_factory=list)
    workload_impact: str = ""
    risk_windows: list[str] = Field(default_factory=list)
    reversibility: str = ""
    hidden_assumptions: list[str] = Field(default_factory=list)
    first_steps: list[ExecutionTask] = Field(default_factory=list)
    review_checkpoint: str = ""


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: str
    end: str
    source: Literal["uploaded", "ai", "manual"] = "uploaded"
    description: str = ""
    locked: bool = False
    conflict: bool = False


class SchedulerOptions(BaseModel):
    day_start_hour: int = 9
    day_end_hour: int = 22
    days: int = 7
    slot_minutes: int = 30
    min_gap_minutes: int = 10


class ScheduleResult(BaseModel):
    scheduled_events: list[CalendarEvent] = Field(default_factory=list)
    unscheduled_tasks: list[ExecutionTask] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

