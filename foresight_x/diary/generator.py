"""Build a DiaryEntry artifact from a source bundle (LLM optional)."""

from __future__ import annotations

import json
import logging
from foresight_x.config import Settings
from foresight_x.diary.prompt import DIARY_ARTIFACT_RULES
from foresight_x.diary.schemas import (
    DiaryActionItem,
    DiaryEntry,
    DiaryLLMPlan,
    DiarySourceBundle,
    DiaryTone,
)
from foresight_x.diary.source_adapter import bundle_has_activity
from foresight_x.diary.store import new_entry_id, stamp_times
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)

_VALID_TONES: set[str] = {
    "reflective",
    "focused",
    "uncertain",
    "excited",
    "stressed",
    "neutral",
    "mixed",
}


def _fallback_entry(user_id: str, bundle: DiarySourceBundle) -> DiaryEntry:
    c = bundle.counts()
    lines = [
        f"{c.chat_messages} chat messages",
        f"{c.voice_turns} voice turns",
        f"{c.reports} decision reports",
        f"{c.calendar_items} calendar items",
        f"{c.memory_refs} memory references",
        f"{c.imported_items} imported/ephemeral notes",
    ]
    preview_bits: list[str] = []
    for m in bundle.chat_messages[:4]:
        t = (m.preview or "").strip()
        if len(t) > 18:
            preview_bits.append(t[:280])
    for v in bundle.voice_turns[:3]:
        t = (v.preview or "").strip()
        if len(t) > 18:
            preview_bits.append(t[:280])
    for mem in bundle.approved_memories[:3]:
        t = (mem.text_preview or "").strip()
        if len(t) > 18:
            preview_bits.append(t[:220])
    if preview_bits:
        body = (
            "Here's what showed up in my logs today. "
            + " ".join(preview_bits[:6])
            + "\n\n"
            + "Volume-wise I also had "
            + ", ".join(lines)
            + "."
        )
        summary = body
    else:
        summary = "Today left traces across my activity: " + ", ".join(lines) + "."
    return DiaryEntry(
        id=new_entry_id(),
        user_id=user_id,
        date=bundle.date,
        timezone=bundle.timezone,
        title=f"Day notes · {bundle.date}",
        summary=summary,
        highlights=[],
        themes=["reflection"],
        tone="neutral",
        action_items=[],
        linked_thread_ids=list(dict.fromkeys(bundle.source_refs.thread_ids)),
        linked_message_ids=list(dict.fromkeys(bundle.source_refs.message_ids)),
        linked_decision_ids=list(dict.fromkeys(bundle.source_refs.decision_ids)),
        linked_calendar_event_ids=list(dict.fromkeys(bundle.source_refs.calendar_event_ids)),
        linked_memory_ids=list(dict.fromkeys(bundle.source_refs.memory_ids)),
        linked_import_ids=list(dict.fromkeys(bundle.source_refs.import_ids)),
        source_counts=c,
        generated_by="auto",
        memory_indexed=False,
    )


def _build_llm_prompt(bundle: DiarySourceBundle) -> str:
    payload = {
        "date": bundle.date,
        "timezone": bundle.timezone,
        "counts": bundle.counts().model_dump(),
        "chat_previews": [m.preview for m in bundle.chat_messages[:48]],
        "voice_previews": [v.preview for v in bundle.voice_turns[:28]],
        "decisions": [d.preview for d in bundle.decision_reports[:14]],
        "calendar": [f"{c.kind}:{c.title}" for c in bundle.calendar_items[:20]],
        "memory_previews": [m.text_preview for m in bundle.approved_memories[:28]],
        "imported_previews": [i.preview for i in bundle.imported_context[:16]],
    }
    return (
        f"{DIARY_ARTIFACT_RULES}\n"
        "tone must be one of: reflective, focused, uncertain, excited, stressed, neutral, mixed.\n"
        "Respond with JSON matching DiaryLLMPlan: title, summary (diary prose only), highlights=[], themes, tone, action_items.\n\n"
        f"DATA_JSON:\n{json.dumps(payload, ensure_ascii=False)}\n"
    )


def _normalize_tone(raw: str) -> DiaryTone | None:
    s = (raw or "").strip().lower()
    if s in _VALID_TONES:
        return s  # type: ignore[return-value]
    return "neutral"


def _plan_to_entry(user_id: str, bundle: DiarySourceBundle, plan: DiaryLLMPlan) -> DiaryEntry:
    actions: list[DiaryActionItem] = []
    for raw in plan.action_items[:12]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        if not title:
            continue
        src = str(raw.get("source") or "manual").strip().lower()
        if src not in ("chat", "decision_report", "calendar", "manual"):
            src = "manual"
        sid = raw.get("source_id")
        actions.append(
            DiaryActionItem(
                title=title[:500],
                source=src,  # type: ignore[arg-type]
                source_id=str(sid).strip() if sid else None,
                completed=bool(raw.get("completed")),
            )
        )
    base = _fallback_entry(user_id, bundle)
    return base.model_copy(
        update={
            "title": (plan.title or base.title)[:200],
            "summary": plan.summary or base.summary,
            "highlights": [],
            "themes": [str(x).strip() for x in plan.themes if str(x).strip()][:10],
            "tone": _normalize_tone(plan.tone),
            "action_items": actions,
            "memory_indexed": False,
        }
    )


def generate_diary_entry(user_id: str, bundle: DiarySourceBundle, *, settings: Settings | None = None) -> DiaryEntry | None:
    """Return a new DiaryEntry, or None if there is nothing meaningful to summarize."""
    if not bundle_has_activity(bundle):
        return None

    entry = _fallback_entry(user_id, bundle)
    s = settings or None
    try:
        from foresight_x.config import load_settings

        s = s or load_settings()
        if not (s.openai_api_key or "").strip():
            raise RuntimeError("no_openai_key")
        llm = build_openai_llm(settings=s, temperature=0.35)
        prompt = _build_llm_prompt(bundle)
        plan = structured_predict(llm, DiaryLLMPlan, prompt)
        entry = _plan_to_entry(user_id, bundle, plan)
    except Exception as e:
        _log.info("diary llm fallback: %s", e)

    return stamp_times(entry, created=True)


def attach_links(entry: DiaryEntry, bundle: DiarySourceBundle) -> DiaryEntry:
    """Ensure linked ids stay aligned with the bundle used for generation."""
    return entry.model_copy(
        update={
            "linked_thread_ids": list(dict.fromkeys(bundle.source_refs.thread_ids)),
            "linked_message_ids": list(dict.fromkeys(bundle.source_refs.message_ids)),
            "linked_decision_ids": list(dict.fromkeys(bundle.source_refs.decision_ids)),
            "linked_calendar_event_ids": list(dict.fromkeys(bundle.source_refs.calendar_event_ids)),
            "linked_memory_ids": list(dict.fromkeys(bundle.source_refs.memory_ids)),
            "linked_import_ids": list(dict.fromkeys(bundle.source_refs.import_ids)),
            "source_counts": bundle.counts(),
            "memory_indexed": False,
        }
    )
