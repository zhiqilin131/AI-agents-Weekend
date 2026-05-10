"""Build a DiaryEntry via clean → distill signals → narrative (two-stage LLM)."""

from __future__ import annotations

import logging

from foresight_x.config import Settings
from foresight_x.diary.diary_clean import clean_diary_source_bundle, is_boilerplate_preview
from foresight_x.diary.heuristic_hints import (
    clip_decision_preview,
    clip_memory_preview,
    collect_concrete_hints,
)
from foresight_x.diary.diary_quality import sanitize_diary_draft, validate_diary_quality
from foresight_x.diary.diary_two_stage import run_two_stage_diary_llm
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


def _base_shell_entry(user_id: str, bundle: DiarySourceBundle) -> DiaryEntry:
    """Placeholder shell with links/counts only — no narrative body."""
    c = bundle.counts()
    return DiaryEntry(
        id=new_entry_id(),
        user_id=user_id,
        date=bundle.date,
        timezone=bundle.timezone,
        title="",
        summary="",
        highlights=[],
        themes=[],
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


def _heuristic_title(
    cal: list,
    *,
    has_decisions: bool,
    heavy_chat: bool,
) -> str:
    if cal and len(cal) == 1 and (cal[0].title or "").strip():
        t = cal[0].title.strip()
        if len(t) > 48:
            t = t[:45] + "…"
        return f"{t} — and the day around it"
    if cal:
        return "Small plans, larger rhythms"
    if has_decisions:
        return "Choosing with care"
    if heavy_chat:
        return "A day of many threads"
    return "Quiet markers"


def _heuristic_diary_entry(
    user_id: str,
    bundle: DiarySourceBundle,
    cleaned: DiarySourceBundle,
) -> DiaryEntry:
    """Sketch with concrete topic hints — clipped previews, not bulk transcripts or volume counts."""
    shell = _base_shell_entry(user_id, bundle)
    cal = cleaned.calendar_items or bundle.calendar_items
    decisions = cleaned.decision_reports or bundle.decision_reports
    memories = cleaned.approved_memories or bundle.approved_memories

    titles: list[str] = [c.title.strip() for c in cal[:6] if (c.title or "").strip()] if cal else []
    hints = collect_concrete_hints(cleaned, calendar_titles=titles, limit=6)

    paras: list[str] = []
    highlights: list[str] = []

    if titles:
        if len(titles) == 1:
            line = f"The schedule carried one clear anchor: {titles[0]}."
            if not hints:
                line += " Around it, other questions and errands stacked without stealing the whole story."
            paras.append(line)
        else:
            joined = "; ".join(titles[:5])
            paras.append(
                f"The calendar held several threads worth remembering—{joined}. "
                "They gave the day a spine alongside whatever chat kept worrying aloud."
            )
        highlights.append("Calendar")

    if hints:
        joined_hints = "; ".join(hints[:6])
        paras.append(
            "Chat and voice kept circling a handful of tangible subjects—"
            f"{joined_hints}. "
            "These are shorthand snapshots, not a replay, but they catch what kept earning airtime."
        )
        highlights.append("Named threads")

    if decisions:
        dp = clip_decision_preview((decisions[0].preview or "").strip(), 145)
        if len(dp) > 28 and not is_boilerplate_preview(dp):
            paras.append(f"Decision-shaped thinking hovered near this thread: {dp}")
        else:
            paras.append(
                "Some attention went to tradeoffs and preferences—the patient work of deciding "
                "without pretending the answer was obvious."
            )
        highlights.append("Decisions")

    if memories:
        mp = clip_memory_preview((memories[0].text_preview or "").strip(), 115)
        if len(mp) > 22 and not is_boilerplate_preview(mp):
            paras.append(f"A saved memory lined up with the day’s drift: {mp}")
        else:
            paras.append(
                "Saved memories surfaced again—markers of what you want carried forward across sessions."
            )
        highlights.append("Memory threads")

    cts = bundle.counts()
    chatter = cts.chat_messages + cts.voice_turns

    if chatter > 35 and not hints:
        paras.append(
            "Most of the day lived in quick exchanges—fine-grained tuning rather than one dramatic scene."
        )
        highlights.append("Conversation")
    elif chatter > 0 and not hints:
        paras.append(
            "Conversation threaded lightly—enough to tilt the tone without one headline moment."
        )
        highlights.append("Conversation")

    if cts.imported_items > 0 and len(paras) < 2:
        paras.append(
            "Imported notes sat at the margins—small handholds when the main arc refused to stay neat."
        )
        highlights.append("Imported notes")

    if not paras:
        paras.append(
            "The day reads like motion without a sharp climax—attention in passes, "
            "small corrections, and the ordinary effort of staying oriented."
        )

    summary = "\n\n".join(paras[:5])
    words = summary.split()
    if len(words) > 340:
        summary = " ".join(words[:340]).rsplit(" ", 1)[0] + "…"

    chatter_heavy = chatter > 25
    title = _heuristic_title(cal, has_decisions=bool(decisions), heavy_chat=chatter_heavy)

    themes: list[str] = []
    if cal:
        themes.append("planning")
    if decisions:
        themes.append("choices")
    if memories:
        themes.append("memory")
    if hints:
        themes.append("conversation")
    if not themes:
        themes = ["reflection"]

    return shell.model_copy(
        update={
            "title": title[:200],
            "summary": summary,
            "highlights": highlights[:5],
            "themes": themes[:5],
            "tone": "reflective",
        }
    )


def _normalize_tone(raw: str) -> DiaryTone | None:
    s = (raw or "").strip().lower()
    if s in _VALID_TONES:
        return s  # type: ignore[return-value]
    return "neutral"


def _plan_to_entry(user_id: str, bundle: DiarySourceBundle, plan: DiaryLLMPlan) -> DiaryEntry:
    actions: list[DiaryActionItem] = []
    for raw in plan.action_items[:8]:
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
    base = _base_shell_entry(user_id, bundle)
    plan_sanitized = sanitize_diary_draft(plan)
    highlights = [str(x).strip() for x in plan_sanitized.highlights if str(x).strip()][:5]
    themes = [str(x).strip() for x in plan_sanitized.themes if str(x).strip()][:5]
    return base.model_copy(
        update={
            "title": (plan_sanitized.title or "A day worth remembering")[:200],
            "summary": plan_sanitized.summary or "",
            "highlights": highlights,
            "themes": themes if themes else ["reflection"],
            "tone": _normalize_tone(plan_sanitized.tone),
            "action_items": actions,
            "memory_indexed": False,
        }
    )


def generate_diary_entry(
    user_id: str,
    bundle: DiarySourceBundle,
    *,
    settings: Settings | None = None,
    persona_context: str | None = None,
) -> DiaryEntry | None:
    """Return a new DiaryEntry, or None if there is nothing meaningful to summarize."""
    if not bundle_has_activity(bundle):
        return None

    cleaned, meta = clean_diary_source_bundle(bundle)
    entry: DiaryEntry | None = None

    try:
        from foresight_x.config import load_settings

        s = settings or load_settings()
        if not (s.openai_api_key or "").strip():
            raise RuntimeError("no_openai_key")
        llm = build_openai_llm(settings=s, temperature=0.42, max_tokens=6144)
        plan = run_two_stage_diary_llm(llm, cleaned, meta, persona_context=persona_context)
        if plan and (plan.summary or "").strip():
            entry = _plan_to_entry(user_id, bundle, plan)
            q = validate_diary_quality(sanitize_diary_draft(plan), strict_title=False)
            if not q.ok:
                _log.info("diary saved with quality notes: %s", q.issues)
        else:
            raise RuntimeError("empty_plan")
    except Exception as e:
        _log.warning("diary llm unavailable or failed; using heuristic sketch: %s", e)
        entry = _heuristic_diary_entry(user_id, bundle, cleaned)

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
