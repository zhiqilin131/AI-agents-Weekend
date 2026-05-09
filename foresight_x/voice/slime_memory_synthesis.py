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
from foresight_x.schemas import SlimePersona, SlimePersonaTone
from foresight_x.voice.slime_identity import EffectiveSlimePersona, get_effective_slime_persona
from foresight_x.voice.slime_persona_prompt import build_slime_persona_prompt, merge_slime_persona_defaults
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


def _prefix_for_persona(eff: EffectiveSlimePersona | None) -> str:
    if not eff:
        return ""
    nick = (eff.user_nickname_for_address or "").strip()
    if not nick or nick == "you":
        return ""
    return f"{nick}, "


def _heuristic_answer(
    user_query: str,
    items: list[MemoryEvidenceItem],
    *,
    eff: EffectiveSlimePersona | None = None,
) -> SlimeSynthesizedAnswer:
    """When no LLM: short glue from chip snippets only (no invention)."""
    prefix = _prefix_for_persona(eff)
    playful = bool(
        eff
        and (
            eff.persona.tone in (SlimePersonaTone.PLAYFUL, SlimePersonaTone.WITTY) or eff.persona.humor >= 2
        )
    )
    if not items:
        core = (
            "I don’t see anything saved about that yet. Tell me more in Profile or Chat and I’ll remember next time."
        )
        if playful and prefix:
            core = "I’m not seeing much on file for that yet — we can add more in Profile or Chat."
        msg = prefix + (core[0].lower() + core[1:] if prefix and core else core)
        return SlimeSynthesizedAnswer(
            assistant_text=msg,
            confidence=0.2,
            used_sources=[],
            should_show_evidence_drawer=False,
        )
    bits = [it.shortText for it in items[:2] if it.shortText]
    glue = " ".join(bits)
    if playful and prefix:
        mid = f"from what I’ve got saved, it looks like: {glue}"
    else:
        mid = f"I found a few clues in your saved stuff: {glue}"
    tail = (" …" if len(items) > 2 else "") + " Open “View evidence” if you want the exact lines."
    body = mid + tail
    msg = prefix + (body[0].lower() + body[1:] if prefix else body)
    return SlimeSynthesizedAnswer(
        assistant_text=msg,
        confidence=0.45,
        used_sources=sorted({it.type for it in items}),
        should_show_evidence_drawer=True,
    )


_SYNTH_PROMPT = """You are the user's Slime Buddy speaking aloud.

{persona_block}

User question (voice):
{query}

Evidence JSON (trusted; do not invent facts not supported here):
{evidence_json}

Rules:
- Answer the question directly; match the persona's warmth, humor, tone, and reply length — stay grounded, not cutesy.
- If the persona specifies how to address the user, use it naturally once or twice, not every sentence.
- If reply length is short, at most two short sentences.
- Use only this evidence. If evidence is thin or conflicting, say so honestly and hedge.
- Do NOT paste bullet lists, labels like "Profile memory:", or long quotes.
- Do NOT say "from your profile memory" repeatedly or describe retrieval mechanics.
- Keep it speakable (no markdown). Use at most one catchphrase if it fits naturally.

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
    slime_persona: SlimePersona | None = None,
    slime_name: str = "Mochi",
    user_ref: str = "you",
    slime_profile_saved: bool = True,
    effective: EffectiveSlimePersona | None = None,
) -> SlimeSynthesizedAnswer:
    eff = effective or get_effective_slime_persona(settings)
    if not (settings.openai_api_key or "").strip():
        return _heuristic_answer(user_query, retrieved_evidence, eff=eff)

    if not retrieved_evidence:
        core = "I don’t see anything saved about that yet. If it matters, add it in Profile or tell me in Chat."
        px = _prefix_for_persona(eff)
        line = px + (core[0].lower() + core[1:] if px else core)
        return SlimeSynthesizedAnswer(
            assistant_text=line,
            confidence=0.25,
            used_sources=[],
            should_show_evidence_drawer=False,
        )

    compact = [
        {"type": it.type, "label": it.label, "text": (it.fullText or it.shortText)[:900]}
        for it in retrieved_evidence
    ]
    evidence_json = json.dumps(compact, ensure_ascii=False)[:10000]
    p = merge_slime_persona_defaults(slime_persona)
    persona_block = build_slime_persona_prompt(
        p,
        "memory_synthesis",
        slime_name=slime_name,
        user_ref=user_ref,
        slime_profile_saved=slime_profile_saved,
    )
    prompt = _SYNTH_PROMPT.format(
        persona_block=persona_block,
        query=user_query.strip()[:2000],
        evidence_json=evidence_json,
    )
    llm = build_openai_llm(settings, temperature=0.35)
    try:
        raw = structured_predict(llm, _SynthOut, prompt)
    except Exception as e:
        _log.warning("memory synthesis failed: %s", e)
        return _heuristic_answer(user_query, retrieved_evidence, eff=eff)

    text = (raw.assistant_text or "").strip()
    if not text:
        return _heuristic_answer(user_query, retrieved_evidence, eff=eff)
    # Strip accidental “From profile:” prefixes
    text = re.sub(r"^(from your profile|from profile|profile memory)\s*:?\s*", "", text, flags=re.I)
    return SlimeSynthesizedAnswer(
        assistant_text=text[:1400],
        confidence=float(raw.confidence),
        used_sources=list(raw.used_sources or []),
        should_show_evidence_drawer=bool(raw.should_show_evidence_drawer),
    )
