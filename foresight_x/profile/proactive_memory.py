"""Proactive memory capture for turns that do not run the full Shadow reply loop.

ShadowChat already asks the reply model to emit ``memory_facts``. Slime tool turns
(calendar, navigation, memory search, profile edits) historically bypassed that
path, which meant useful autobiographical details in those turns were not saved.
This module provides a small, modular capture pass with the same durability and
merge rules used by ShadowChat.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.profile.memory_classification import refine_memory_category
from foresight_x.profile.memory_rules import enrich_memory_fact, memory_rule_summary
from foresight_x.profile.merge import append_profile_memory_records_with_events
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact
from foresight_x.shadow.memory_durability import classify_memory_durability
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)

SourceChat = Literal["shadow_chat", "slime_voice", "slime_buddy", "slimchat", "slimbody"]


class ProactiveMemoryDraft(BaseModel):
    category: Literal["identity", "views", "behavior", "goals", "constraints", "other"] = "other"
    text: str = Field(max_length=280)
    subject_ref: str = "user"
    predicate: str = ""
    object_value: str = ""
    evidence: str = Field(default="", max_length=260)
    confidence: float = Field(default=0.72, ge=0.0, le=1.0)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    retrieval_tags: list[str] = Field(default_factory=list)


class ProactiveMemoryExtract(BaseModel):
    memory_facts: list[ProactiveMemoryDraft] = Field(default_factory=list)


@dataclass
class ProactiveMemoryCaptureResult:
    events: list[dict[str, Any]]
    saved_texts: list[str]


_PROMPT = """Extract durable user-profile memories from this conversation turn.

Memory principles:
{rules}

Save only long-term useful information, such as:
- user preferences, values, goals, constraints, important relationships, recurring concerns, decision patterns
- project context, role/context updates, meaningful life changes, stable routines

Avoid saving:
- greetings, filler, temporary logistics, one-off moods, jokes, hypotheticals, roleplay
- assistant statements, advice, or private secrets
- duplicate facts already likely represented

Use one memory row per atomic fact. Prefer typed triples when possible:
- user dating Rose -> subject_ref=user, predicate=dating, object_value=Rose
- user works_on Foresight-X -> subject_ref=user, predicate=works_on, object_value=Foresight-X
- user prefers concise answers -> subject_ref=user, predicate=prefers, object_value=concise answers

Latest user message:
---
{user_text}
---

Assistant response / tool result summary:
---
{assistant_text}
---

Return JSON matching ProactiveMemoryExtract."""


def _coerce_category(raw: str) -> MemoryFactCategory:
    return {
        "identity": MemoryFactCategory.IDENTITY,
        "views": MemoryFactCategory.VIEWS,
        "behavior": MemoryFactCategory.BEHAVIOR,
        "goals": MemoryFactCategory.GOALS,
        "constraints": MemoryFactCategory.CONSTRAINTS,
        "other": MemoryFactCategory.OTHER,
    }.get(str(raw or "").strip().lower(), MemoryFactCategory.OTHER)


def _heuristic_drafts(text: str) -> list[ProactiveMemoryDraft]:
    """Small no-LLM fallback for explicit durable phrases."""
    raw = (text or "").strip()
    if not raw:
        return []
    out: list[ProactiveMemoryDraft] = []
    patterns = [
        (r"(?i)\bmy girlfriend is\s+([A-Z][\w' -]{1,60})", "identity", "dating"),
        (r"(?i)\bmy boyfriend is\s+([A-Z][\w' -]{1,60})", "identity", "dating"),
        (r"(?i)\bmy partner is\s+([A-Z][\w' -]{1,60})", "identity", "dating"),
        (r"(?i)\bI (?:am|'m) working on\s+([^.;,\n]{2,80})", "goals", "works_on"),
        (r"(?i)\bI (?:want|need|plan) to\s+([^.;,\n]{2,100})", "goals", "plans_to"),
        (r"(?i)\bI prefer\s+([^.;,\n]{2,100})", "views", "prefers"),
    ]
    for pat, cat, pred in patterns:
        for m in re.finditer(pat, raw):
            obj = " ".join(m.group(1).split()).strip()
            if not obj:
                continue
            if pred == "dating":
                line = f"{obj} is the user's romantic partner."
            else:
                line = f"User {pred.replace('_', ' ')} {obj}."
            out.append(
                ProactiveMemoryDraft(
                    category=cat, text=line[:280], subject_ref="user", predicate=pred, object_value=obj[:500], evidence=m.group(0)
                )
            )
    return out[:4]


def _drafts_with_llm(
    *,
    settings: Settings,
    user_text: str,
    assistant_text: str,
    llm_model: str | None,
) -> list[ProactiveMemoryDraft]:
    if not (settings.openai_api_key or "").strip():
        return _heuristic_drafts(user_text)
    llm = build_openai_llm(settings, temperature=0.0, model=llm_model)
    prompt = _PROMPT.format(
        rules=memory_rule_summary(),
        user_text=user_text.strip()[:3000],
        assistant_text=assistant_text.strip()[:1600],
    )
    try:
        ext = structured_predict(llm, ProactiveMemoryExtract, prompt)
    except Exception as exc:
        _log.debug("proactive memory extraction failed; using heuristic fallback: %s", exc)
        return _heuristic_drafts(user_text)
    return list(ext.memory_facts or [])[:8]


def capture_turn_memory(
    *,
    settings: Settings,
    user_text: str,
    assistant_text: str = "",
    source_chat: SourceChat = "slime_voice",
    source_thread_id: str = "",
    source_message_id: str = "",
    llm_model: str | None = None,
) -> ProactiveMemoryCaptureResult:
    """Extract, filter, merge, and persist durable memories from one conversation/tool turn."""
    user_text = (user_text or "").strip()
    if len(user_text) < 8:
        return ProactiveMemoryCaptureResult(events=[], saved_texts=[])

    drafts = _drafts_with_llm(
        settings=settings,
        user_text=user_text,
        assistant_text=assistant_text,
        llm_model=llm_model,
    )
    if not drafts:
        return ProactiveMemoryCaptureResult(events=[], saved_texts=[])

    llm_cat = None
    if settings.memory_fact_category_llm_refine and (settings.openai_api_key or "").strip():
        try:
            llm_cat = build_openai_llm(settings, temperature=0.0, model=llm_model)
        except Exception:
            llm_cat = None

    records: list[ProfileMemoryFact] = []
    for d in drafts:
        text = (d.text or "").strip()
        pred = (d.predicate or "").strip()[:200]
        obj = (d.object_value or "").strip()[:500]
        if not text and not (pred and obj):
            continue
        line = text or f"{(d.subject_ref or 'user').strip() or 'user'} {pred.replace('_', ' ')} {obj}".strip()
        cat0 = _coerce_category(d.category)
        cls = classify_memory_durability(
            user_text,
            [{"role": "user", "content": user_text}],
            line or obj,
            category_hint=cat0,
            predicate_hint=pred,
        )
        if cls.durability != "long_term_profile":
            continue
        cat = refine_memory_category(
            cat0,
            text=line[:500],
            evidence=(d.evidence or "").strip()[:260],
            predicate=pred,
            subject_ref=(d.subject_ref or "user").strip() or "user",
            llm=llm_cat,
            settings=settings,
        )
        rec = ProfileMemoryFact(
            category=cat,
            text=line[:500],
            source="shadow" if source_chat == "shadow_chat" else "user",
            subject_ref=(d.subject_ref or "user").strip() or "user",
            predicate=pred,
            object_value=obj,
            evidence=(d.evidence or user_text)[:260],
            confidence=float(d.confidence or cls.confidence),
            importance=float(d.importance or 0.5),
            retrieval_tags=[str(x).strip() for x in (d.retrieval_tags or []) if str(x).strip()],
        )
        records.append(
            enrich_memory_fact(
                rec,
                source_chat=source_chat,
                source_thread_id=source_thread_id,
                source_message_id=source_message_id,
                extra_text=user_text,
            )
        )

    if not records:
        return ProactiveMemoryCaptureResult(events=[], saved_texts=[])

    profile = load_user_profile(settings=settings)
    updated, events = append_profile_memory_records_with_events(profile, records)
    if not events:
        return ProactiveMemoryCaptureResult(events=[], saved_texts=[])
    save_user_profile(updated, settings=settings)
    event_dicts = [ev.model_dump() for ev in events]
    return ProactiveMemoryCaptureResult(
        events=event_dicts,
        saved_texts=[str(ev.get("text") or "") for ev in event_dicts if str(ev.get("text") or "").strip()],
    )
