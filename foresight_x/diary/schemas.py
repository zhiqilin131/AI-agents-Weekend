"""Pydantic contracts for diary artifacts (references only; source-of-truth stays elsewhere)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

DiaryTone = Literal["reflective", "focused", "uncertain", "excited", "stressed", "neutral", "mixed"]

DiaryMemoryStatus = Literal["not_memory", "saved_selected_insights"]

DiaryActionSource = Literal["chat", "decision_report", "calendar", "manual"]


class DiaryActionItem(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    source: DiaryActionSource = "manual"
    source_id: str | None = None
    completed: bool = False


class DiarySourceRefs(BaseModel):
    thread_ids: list[str] = Field(default_factory=list)
    message_ids: list[str] = Field(default_factory=list)
    decision_ids: list[str] = Field(default_factory=list)
    calendar_event_ids: list[str] = Field(default_factory=list)
    calendar_draft_ids: list[str] = Field(default_factory=list)
    memory_ids: list[str] = Field(default_factory=list)
    import_ids: list[str] = Field(default_factory=list)


class DiarySourceCounts(BaseModel):
    chat_messages: int = 0
    voice_turns: int = 0
    reports: int = 0
    calendar_items: int = 0
    memory_refs: int = 0
    imported_items: int = 0


class ChatMessageRef(BaseModel):
    thread_id: str
    message_id: str
    created_at: str = ""
    role: str = ""
    preview: str = ""
    is_voice_turn: bool = False


class VoiceTurnRef(BaseModel):
    thread_id: str
    message_id: str
    created_at: str = ""
    preview: str = ""


class DecisionReportRef(BaseModel):
    decision_id: str
    timestamp: str = ""
    preview: str = ""


class CalendarItemRef(BaseModel):
    kind: Literal["event", "draft"]
    id: str
    title: str = ""
    start: str = ""
    end: str = ""


class MemoryFactRef(BaseModel):
    memory_id: str
    text_preview: str = ""
    source: str = ""


class ImportedContextRef(BaseModel):
    kind: Literal["memory_fact", "temporary_context"]
    id: str
    preview: str = ""
    thread_id: str | None = None  # set for temporary_context (chat thread anchor)


class DiarySourceDiagnostics(BaseModel):
    """Counts for debugging empty diary days (not persisted on DiaryEntry)."""

    skipped_chat_messages_no_timestamp: int = 0
    undated_memory_records_before_backfill: int = 0
    profile_memory_facts_backfilled: bool = False
    memory_records_matched_for_day: int = 0
    memory_records_still_without_created_at: int = 0


class DiarySourceBundle(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    timezone: str = "UTC"
    diagnostics: DiarySourceDiagnostics = Field(default_factory=DiarySourceDiagnostics)
    chat_messages: list[ChatMessageRef] = Field(default_factory=list)
    voice_turns: list[VoiceTurnRef] = Field(default_factory=list)
    decision_reports: list[DecisionReportRef] = Field(default_factory=list)
    calendar_items: list[CalendarItemRef] = Field(default_factory=list)
    approved_memories: list[MemoryFactRef] = Field(default_factory=list)
    imported_context: list[ImportedContextRef] = Field(default_factory=list)
    source_refs: DiarySourceRefs = Field(default_factory=DiarySourceRefs)

    def counts(self) -> DiarySourceCounts:
        cal_n = len(self.calendar_items)
        return DiarySourceCounts(
            chat_messages=len(self.chat_messages),
            voice_turns=len(self.voice_turns),
            reports=len(self.decision_reports),
            calendar_items=cal_n,
            memory_refs=len(self.approved_memories),
            imported_items=len(self.imported_context),
        )


class DiaryEntry(BaseModel):
    id: str = Field(min_length=8)
    user_id: str = Field(min_length=1)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    timezone: str = "UTC"
    title: str = ""
    summary: str = ""
    highlights: list[str] = Field(default_factory=list)
    themes: list[str] = Field(default_factory=list)
    tone: DiaryTone | None = None
    action_items: list[DiaryActionItem] = Field(default_factory=list)
    linked_thread_ids: list[str] = Field(default_factory=list)
    linked_message_ids: list[str] = Field(default_factory=list)
    linked_decision_ids: list[str] = Field(default_factory=list)
    linked_calendar_event_ids: list[str] = Field(default_factory=list)
    linked_memory_ids: list[str] = Field(default_factory=list)
    linked_import_ids: list[str] = Field(default_factory=list)
    source_counts: DiarySourceCounts = Field(default_factory=DiarySourceCounts)
    generated_by: Literal["auto", "manual"] = "auto"
    user_edited: bool = False
    visibility: Literal["private"] = "private"
    memory_status: DiaryMemoryStatus = "not_memory"
    memory_indexed: bool = False
    created_at: str = ""
    updated_at: str = ""

    @field_validator("memory_indexed", mode="before")
    @classmethod
    def _force_not_indexed(cls, v: Any) -> bool:
        """Diary entries must never default into vector decision memory."""
        return False


class DiaryMonthSummaryItem(BaseModel):
    date: str
    id: str | None = None
    has_entry: bool = False
    title: str = ""
    tone: DiaryTone | None = None
    summary_preview: str = ""


class DiaryLLMPlan(BaseModel):
    """Structured output from the diary narrative stage LLM."""

    title: str = ""
    summary: str = ""
    highlights: list[str] = Field(default_factory=list)
    themes: list[str] = Field(default_factory=list)
    tone: str = "neutral"
    action_items: list[dict[str, Any]] = Field(default_factory=list)


class DiarySignalBundle(BaseModel):
    """Stage-1 distillation: high-signal themes only (no raw transcript)."""

    major_themes: list[str] = Field(default_factory=list)
    important_moments: list[str] = Field(default_factory=list)
    decisions_discussed: list[str] = Field(default_factory=list)
    actions_created: list[str] = Field(default_factory=list)
    people_mentioned: list[str] = Field(default_factory=list)
    recurring_patterns: list[str] = Field(default_factory=list)
    discarded_noise: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _cap_lists(self) -> DiarySignalBundle:
        def clean(xs: list[str], n: int) -> list[str]:
            return [str(x).strip() for x in xs if str(x).strip()][:n]

        self.major_themes = clean(self.major_themes, 3)
        self.important_moments = clean(self.important_moments, 4)
        self.decisions_discussed = clean(self.decisions_discussed, 3)
        self.actions_created = clean(self.actions_created, 3)
        self.people_mentioned = clean(self.people_mentioned, 3)
        self.recurring_patterns = clean(self.recurring_patterns, 3)
        self.discarded_noise = [str(x).strip() for x in self.discarded_noise if str(x).strip()][:24]
        return self


class CleanDiaryBundleMeta(BaseModel):
    """Metadata from noise filtering / deduplication."""

    discarded_previews: list[str] = Field(default_factory=list)
    duplicate_collapsed: int = 0
    noise_filtered: int = 0
    offensive_redacted: int = 0


class DiaryQualityResult(BaseModel):
    ok: bool = False
    issues: list[str] = Field(default_factory=list)
    word_count: int = 0
    paragraph_count: int = 0
