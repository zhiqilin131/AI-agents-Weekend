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
        score = h.get("rank_score", h.get("score"))
        eid = f"ev-{i}-{uuid.uuid4().hex[:8]}"
        if kind in ("about_me", "priority_line", "memory_fact"):
            typ: MemoryEvidenceType = "profile"
            label = "Profile fact" if kind == "memory_fact" else "Profile note"
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
                confidence=float(score) if isinstance(score, int | float) else None,
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


_EVIDENCE_STOPWORDS = {
    "about",
    "because",
    "category",
    "evidence",
    "fact",
    "from",
    "identity",
    "memory",
    "note",
    "profile",
    "said",
    "saved",
    "structured",
    "that",
    "their",
    "there",
    "this",
    "user",
    "with",
    "your",
}


def _evidence_texts(items: list[MemoryEvidenceItem]) -> list[str]:
    return [
        (it.fullText or it.shortText or "").replace("\n", " ").strip()
        for it in items
        if (it.fullText or it.shortText or "").strip()
    ]


def _clean_evidence_line(text: str, max_chars: int = 180) -> str:
    t = " ".join((text or "").replace(" | ", ". ").split())
    t = re.sub(r"\bstructured:\s*", "stored as ", t, flags=re.I)
    t = re.sub(r"\bevidence:\s*", "evidence says ", t, flags=re.I)
    t = t.strip(" .")
    if len(t) > max_chars:
        t = t[: max_chars - 1].rstrip() + "…"
    return t


def _meaningful_tokens(text: str) -> set[str]:
    raw = re.findall(r"[a-zA-Z][a-zA-Z']{3,}|[\u4e00-\u9fff]{2,}", text or "")
    return {t.lower().strip("'") for t in raw if t.lower().strip("'") not in _EVIDENCE_STOPWORDS}


def _answer_uses_concrete_evidence(answer: str, items: list[MemoryEvidenceItem]) -> bool:
    evidence_tokens: set[str] = set()
    for text in _evidence_texts(items):
        evidence_tokens.update(_meaningful_tokens(text))
    if not evidence_tokens:
        return True
    answer_tokens = _meaningful_tokens(answer)
    return bool(evidence_tokens & answer_tokens)


def _is_direct_memory_question(query: str) -> bool:
    q = (query or "").strip().lower()
    return bool(
        re.search(
            r"\b(who is|who's|what is|what's|what do you know|do you remember|remember who|my life|about me)\b",
            q,
        )
        or re.search(r"谁是|是谁|记得.*吗|关于我|我的生活|我是谁", query or "")
    )


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
    lines = [_clean_evidence_line(x) for x in _evidence_texts(items[:4])]
    lines = [x for x in lines if x]
    glue = "; ".join(lines[:3])
    if _is_direct_memory_question(user_query):
        mid = f"I found this saved: {glue}"
    elif playful and prefix:
        mid = f"from what I’ve got saved, the concrete bits are: {glue}"
    else:
        mid = f"I found these concrete notes: {glue}"
    tail = " I found a few more related notes too." if len(items) > 3 else ""
    body = mid + tail
    msg = prefix + (body[0].lower() + body[1:] if prefix else body)
    return SlimeSynthesizedAnswer(
        assistant_text=msg,
        confidence=0.55,
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
- Answer the question directly with concrete details from Evidence JSON; match the persona's warmth, humor, tone, and reply length — stay grounded, not cutesy.
- If the user asks a direct memory question ("who is my girlfriend?", "what is my life like?", "what do you know about me?"), the first sentence must state the specific remembered name/detail(s) or say exactly which part is missing.
- For broad "what is my life like" questions, synthesize 2–4 concrete remembered details instead of giving advice.
- If the persona specifies how to address the user, use it naturally once or twice, not every sentence.
- If reply length is short, at most two short sentences.
- Use only this evidence. If evidence is thin or conflicting, say so honestly and hedge.
- Do NOT give generic relationship/life advice unless it is clearly tied to a retrieved fact.
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
    llm = build_openai_llm(settings, temperature=0.2)
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
    if not _answer_uses_concrete_evidence(text, retrieved_evidence):
        return _heuristic_answer(user_query, retrieved_evidence, eff=eff)
    return SlimeSynthesizedAnswer(
        assistant_text=text[:1400],
        confidence=float(raw.confidence),
        used_sources=list(raw.used_sources or []),
        should_show_evidence_drawer=bool(raw.should_show_evidence_drawer),
    )
