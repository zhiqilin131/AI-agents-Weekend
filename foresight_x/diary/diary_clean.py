"""Noise filtering and deduplication before diary signal distillation."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Iterable

from foresight_x.diary.schemas import (
    CalendarItemRef,
    ChatMessageRef,
    CleanDiaryBundleMeta,
    DecisionReportRef,
    DiarySourceBundle,
    ImportedContextRef,
    MemoryFactRef,
    VoiceTurnRef,
)

_NOISE_SUBSTRINGS = (
    "confirm below to save",
    "confirm below",
    "voice model warmed",
    "voice model warmed up",
    "here's what showed up in my logs",
    "volume-wise i also had",
    "loading diary",
    "tool_call",
    "function_call",
    "```json",
)

_NAME_LOOP_HINTS = (
    "what is your name",
    "what would you like to call me",
    "what should i call you",
    "how should i address you",
)

# Optional extra markers (e.g. tests); avoid literal slurs in repo.
OFFENSIVE_MARKERS: tuple[str, ...] = ()


def _norm_preview(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip()).lower()[:400]


def _is_noise(text: str) -> bool:
    low = (text or "").lower().strip()
    if len(low) < 8:
        return True
    return any(n in low for n in _NOISE_SUBSTRINGS)


def is_boilerplate_preview(text: str) -> bool:
    """True if preview is too short or matches assistant/UI noise (diary hint extraction)."""
    return _is_noise(text)


def _is_mostly_name_loop(text: str) -> bool:
    low = (text or "").lower()
    hits = sum(1 for h in _NAME_LOOP_HINTS if h in low)
    return hits >= 2 and len(low) < 360


def _offensive_hit(text: str) -> bool:
    low = (text or "").lower()
    return any(m.lower() in low for m in OFFENSIVE_MARKERS)


def _near_duplicate(a: str, b: str, threshold: float = 0.88) -> bool:
    na, nb = _norm_preview(a), _norm_preview(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    return SequenceMatcher(None, na, nb).ratio() >= threshold


def clean_diary_source_bundle(bundle: DiarySourceBundle) -> tuple[DiarySourceBundle, CleanDiaryBundleMeta]:
    """Return a cleaned bundle with boilerplate/offensive/near-duplicate previews reduced."""
    discarded: list[str] = []
    noise_filtered = 0
    offensive_redacted = 0
    dup_collapsed = 0

    chats_out: list[ChatMessageRef] = []
    for m in bundle.chat_messages:
        p = (m.preview or "").strip()
        if not p:
            noise_filtered += 1
            discarded.append("empty_chat_preview")
            continue
        if _offensive_hit(p):
            offensive_redacted += 1
            discarded.append("offensive_chat_redacted")
            continue
        if _is_noise(p):
            noise_filtered += 1
            discarded.append("noise_chat")
            continue
        if _is_mostly_name_loop(p):
            chats_out.append(
                ChatMessageRef(
                    thread_id=m.thread_id,
                    message_id=m.message_id,
                    created_at=m.created_at,
                    role=m.role,
                    preview="Naming and how we should address each other came up more than once.",
                    is_voice_turn=m.is_voice_turn,
                )
            )
            discarded.append("name_loop_chat_note")
            continue
        chats_out.append(m)

    voices_out: list[VoiceTurnRef] = []
    for v in bundle.voice_turns:
        p = (v.preview or "").strip()
        if not p or _is_noise(p):
            noise_filtered += 1
            discarded.append("noise_voice")
            continue
        if _offensive_hit(p):
            offensive_redacted += 1
            discarded.append("offensive_voice_redacted")
            continue
        voices_out.append(v)

    kept_chats: list[ChatMessageRef] = []
    prev_texts: list[str] = []
    for m in chats_out:
        pr = (m.preview or "").strip()
        if any(_near_duplicate(pr, pt) for pt in prev_texts):
            dup_collapsed += 1
            continue
        prev_texts.append(pr)
        kept_chats.append(m)

    voice_kept: list[VoiceTurnRef] = []
    prev_v: list[str] = []
    for v in voices_out:
        pr = (v.preview or "").strip()
        if any(_near_duplicate(pr, pt) for pt in prev_v):
            dup_collapsed += 1
            continue
        prev_v.append(pr)
        voice_kept.append(v)

    cal_kept: list[CalendarItemRef] = []
    seen_titles: set[str] = set()
    for c in bundle.calendar_items:
        key = _norm_preview(c.title or "")
        if key in seen_titles:
            dup_collapsed += 1
            discarded.append("duplicate_calendar_title")
            continue
        seen_titles.add(key)
        cal_kept.append(c)

    mem_kept: list[MemoryFactRef] = []
    prev_m: list[str] = []
    for mem in bundle.approved_memories:
        pr = (mem.text_preview or "").strip()
        if not pr:
            continue
        if _offensive_hit(pr):
            offensive_redacted += 1
            discarded.append("offensive_memory_redacted")
            continue
        if any(_near_duplicate(pr, pt) for pt in prev_m):
            dup_collapsed += 1
            continue
        prev_m.append(pr)
        mem_kept.append(mem)

    decisions_kept: list[DecisionReportRef] = []
    prev_d: list[str] = []
    for d in bundle.decision_reports:
        pr = (d.preview or "").strip()
        if not pr:
            continue
        if any(_near_duplicate(pr, pt) for pt in prev_d):
            dup_collapsed += 1
            continue
        prev_d.append(pr)
        decisions_kept.append(d)

    imports_kept: list[ImportedContextRef] = []
    prev_i: list[str] = []
    for i in bundle.imported_context:
        pr = (i.preview or "").strip()
        if not pr or _offensive_hit(pr):
            continue
        if any(_near_duplicate(pr, pt) for pt in prev_i):
            dup_collapsed += 1
            continue
        prev_i.append(pr)
        imports_kept.append(i)

    cleaned = DiarySourceBundle(
        date=bundle.date,
        timezone=bundle.timezone,
        diagnostics=bundle.diagnostics,
        chat_messages=kept_chats,
        voice_turns=voice_kept,
        decision_reports=decisions_kept,
        calendar_items=cal_kept,
        approved_memories=mem_kept,
        imported_context=imports_kept,
        source_refs=bundle.source_refs,
    )
    meta = CleanDiaryBundleMeta(
        discarded_previews=discarded[:80],
        duplicate_collapsed=dup_collapsed,
        noise_filtered=noise_filtered,
        offensive_redacted=offensive_redacted,
    )
    return cleaned, meta
