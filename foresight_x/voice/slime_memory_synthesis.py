"""Turn retrieved memory hits into a short spoken answer + structured evidence (no raw dump)."""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict
from foresight_x.voice.slime_voice_router import SlimeVoiceContext

_log = logging.getLogger(__name__)

MemoryEvidenceType = Literal["profile", "chat_history", "decision_report", "memory", "calendar", "unknown"]


class MemoryEvidenceItem(BaseModel):
    id: str
    type: MemoryEvidenceType
    label: str
    shortText: str
    fullText: str | None = None
    sourceId: str | None = None
    confidence: float | None = None


class SlimeSynthesizedAnswer(BaseModel):
    assistant_text: str = Field(..., max_length=1400)
    confidence: float = Field(default=0.72, ge=0.0, le=1.0)
    used_sources: list[str] = Field(default_factory=list)
    should_show_evidence_drawer: bool = True


def evidence_items_from_hits(hits: list[dict[str, Any]]) -> list[MemoryEvidenceItem]:
    """Map search hits to lightweight evidence chips (labels per product copy)."""
    out: list[MemoryEvidenceItem] = []
    for i, h in enumerate(hits[:10]):
        kind = str(h.get("kind") or "")
        text = (h.get("text") or "").strip()
        sid = str(
            h.get("id")
            or h.get("decision_id")
            or h.get("message_id")
            or h.get("thread_id")
            or f"{i}"
        )
        eid = f"ev-{i}-{uuid.uuid4().hex[:8]}"
        if kind in ("about_me", "priority_line", "memory_fact"):
            typ: MemoryEvidenceType = "profile"
            label = "Profile clue"
        elif kind in ("chat_message", "thread_summary"):
            typ = "chat_history"
            label = "Past chat"
        elif kind == "decision_trace":
            typ = "decision_report"
            label = "Decision record"
        else:
            typ = "memory"
            label = "Memory"
        short = text.replace("\n", " ").strip()
        if len(short) > 50:
            short = short[:47] + "…"
        out.append(
            MemoryEvidenceItem(
                id=eid,
                type=typ,
                label=label,
                shortText=short or label,
                fullText=text[:4000] if text else None,
                sourceId=sid[:120],
                confidence=None,
            )
        )
    return out


def _heuristic_answer(user_query: str, items: list[MemoryEvidenceItem]) -> SlimeSynthesizedAnswer:
    """When no LLM: short glue from chip snippets only (no invention)."""
    if not items:
        return SlimeSynthesizedAnswer(
            assistant_text="I don’t see anything saved about that yet. You can tell me more in Profile or Chat and I’ll remember for next time.",
            confidence=0.2,
            used_sources=[],
            should_show_evidence_drawer=False,
        )
    bits = [it.shortText for it in items[:2] if it.shortText]
    glue = " ".join(bits)
    return SlimeSynthesizedAnswer(
        assistant_text=f"I found a few clues in your saved stuff: {glue}"
        + (" …" if len(items) > 2 else "")
        + " Open “View evidence” if you want the exact lines.",
        confidence=0.45,
        used_sources=sorted({it.type for it in items}),
        should_show_evidence_drawer=True,
    )


_SYNTH_PROMPT = """You are a friendly Slime companion speaking aloud to the user.

User question (voice):
{query}

Evidence JSON (trusted; do not invent facts not supported here):
{evidence_json}

Rules:
- Answer the question directly in 1–4 short sentences, conversational, warm, not robotic.
- Use only this evidence. If evidence is thin or conflicting, say so honestly and hedge.
- Do NOT paste bullet lists, labels like "Profile memory:", or long quotes.
- Do NOT say "from your profile memory" repeatedly or describe retrieval mechanics.
- Keep it speakable (no markdown).

Return structured fields only.
"""


class _SynthOut(BaseModel):
    assistant_text: str = Field(..., max_length=1400)
    confidence: float = Field(ge=0.0, le=1.0, default=0.75)
    used_sources: list[str] = Field(default_factory=list)
    should_show_evidence_drawer: bool = True


def synthesize_memory_answer(
    user_query: str,
    retrieved_evidence: list[MemoryEvidenceItem],
    user_context: SlimeVoiceContext,
    *,
    settings: Settings,
) -> SlimeSynthesizedAnswer:
    if not (settings.openai_api_key or "").strip():
        return _heuristic_answer(user_query, retrieved_evidence)

    if not retrieved_evidence:
        return SlimeSynthesizedAnswer(
            assistant_text="I don’t see anything saved about that yet. If it matters, add it in Profile or tell me in Chat.",
            confidence=0.25,
            used_sources=[],
            should_show_evidence_drawer=False,
        )

    compact = [
        {"type": it.type, "label": it.label, "text": (it.fullText or it.shortText)[:900]}
        for it in retrieved_evidence
    ]
    evidence_json = json.dumps(compact, ensure_ascii=False)[:10000]
    prompt = _SYNTH_PROMPT.format(query=user_query.strip()[:2000], evidence_json=evidence_json)
    llm = build_openai_llm(settings, temperature=0.35)
    try:
        raw = structured_predict(llm, _SynthOut, prompt)
    except Exception as e:
        _log.warning("memory synthesis failed: %s", e)
        return _heuristic_answer(user_query, retrieved_evidence)

    text = (raw.assistant_text or "").strip()
    if not text:
        return _heuristic_answer(user_query, retrieved_evidence)
    # Strip accidental “From profile:” prefixes
    text = re.sub(r"^(from your profile|from profile|profile memory)\s*:?\s*", "", text, flags=re.I)
    return SlimeSynthesizedAnswer(
        assistant_text=text[:1400],
        confidence=float(raw.confidence),
        used_sources=list(raw.used_sources or []),
        should_show_evidence_drawer=bool(raw.should_show_evidence_drawer),
    )
