"""Calendar Agent Pydantic schemas (internal execution calendar)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

IntentType = Literal[
    "create_event",
    "schedule_tasks",
    "reschedule",
    "review_checkpoint",
    "find_time",
    "sync_calendar",
    "unknown",
]
CalendarSource = Literal["slime_voice", "shadow_chat", "decision_report", "manual"]
EventSource = Literal["uploaded", "ai_draft", "ai", "manual", "google", "confirmed"]
TaskSource = Literal["decision_report", "voice", "manual"]
TaskEnergy = Literal["deep_work", "admin", "creative", "social", "recovery"]
TaskPriority = Literal["low", "medium", "high"]
Flexibility = Literal["fixed", "flexible", "very_flexible"]
ConflictType = Literal[
    "overlap",
    "outside_working_hours",
    "deadline_risk",
    "too_dense",
    "preference_mismatch",
]
Severity = Literal["low", "medium", "high"]
AlternativePreference = Literal["earlier", "less_intense", "later", "focus_time"]
DraftStatus = Literal["draft", "confirmed", "cancelled"]


class CalendarIntent(BaseModel):
    intent_type: IntentType = "unknown"
    title: str | None = None
    description: str | None = None
    date_hint: str | None = None
    time_hint: str | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    deadline_hint: str | None = None
    priority: TaskPriority | None = None
    flexibility: Flexibility | None = None
    can_split: bool | None = None
    source: CalendarSource = "manual"
    thread_id: str | None = None
    decision_id: str | None = None
    current_event_id: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class CalendarTask(BaseModel):
    id: str
    title: str
    description: str | None = None
    duration_minutes: int = Field(ge=15, le=480)
    priority: TaskPriority = "medium"
    deadline: str | None = None
    earliest_start: str | None = None
    latest_end: str | None = None
    can_split: bool = False
    min_chunk_minutes: int | None = Field(default=None, ge=15, le=240)
    energy_type: TaskEnergy | None = None
    source: TaskSource = "manual"
    decision_id: str | None = None
    thread_id: str | None = None


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: str
    end: str
    description: str | None = None
    source: EventSource = "ai_draft"
    locked: bool = False
    conflict: bool = False
    decision_id: str | None = None
    thread_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Conflict(BaseModel):
    type: ConflictType
    message: str
    affected_event_ids: list[str] = Field(default_factory=list)
    severity: Severity = "medium"


class ScheduleAlternative(BaseModel):
    label: str
    proposed_events: list[CalendarEvent] = Field(default_factory=list)
    score: float = 0.0
    tradeoff_summary: str = ""


class CalendarDraft(BaseModel):
    draft_id: str
    intent: CalendarIntent
    tasks: list[CalendarTask] = Field(default_factory=list)
    proposed_events: list[CalendarEvent] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    alternatives: list[ScheduleAlternative] = Field(default_factory=list)
    requires_confirmation: bool = True
    explanation: str = ""
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    status: DraftStatus = "draft"
    created_at: str = ""


class CalendarPreferences(BaseModel):
    timezone: str = "UTC"
    working_hours: dict[str, str] = Field(default_factory=lambda: {"start": "09:00", "end": "22:00"})
    focus_time_preferences: list[str] = Field(default_factory=list)
    avoid_times: list[str] = Field(default_factory=list)
    buffer_minutes: int = Field(default=10, ge=0, le=120)
    max_daily_deep_work_hours: int = Field(default=4, ge=1, le=12)
    preferred_chunk_minutes: int = Field(default=60, ge=30, le=120)
    energy_pattern_notes: list[str] = Field(default_factory=list)
    defaults_only: bool = True


class ResolvedTimeHints(BaseModel):
    """Resolved scheduling window hints (ISO datetimes UTC or local as stored)."""

    window_start_local: str | None = None
    window_end_local: str | None = None
    preferred_start_hour: int | None = None
    preferred_end_hour: int | None = None
    notes: list[str] = Field(default_factory=list)
