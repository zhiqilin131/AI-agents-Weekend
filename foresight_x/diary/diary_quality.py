"""Post-generation validation for diary narrative drafts."""

from __future__ import annotations

import re
from collections import Counter

from foresight_x.diary.schemas import DiaryLLMPlan, DiaryQualityResult

_BANNED_SUMMARY_PHRASES = (
    "chat messages",
    "voice turns",
    "decision reports",
    "memory references",
    "imported/ephemeral",
    "confirm below",
    "voice model warmed",
    "here's what showed up",
    "volume-wise",
    "tool_call",
    "```json",
)

_GENERIC_TITLE_PREFIXES = (
    "day notes ·",
    "quiet day ·",
)

def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text or ""))


def validate_diary_quality(draft: DiaryLLMPlan, *, strict_title: bool = True) -> DiaryQualityResult:
    """Guardrails: length, banned log language, paragraph cap, coarse repetition."""
    issues: list[str] = []
    summary = (draft.summary or "").strip()
    title = (draft.title or "").strip()
    wc = _word_count(summary)
    paras = [p.strip() for p in summary.split("\n\n") if p.strip()]
    pcount = len(paras) if paras else (1 if summary else 0)

    low = summary.lower()
    for phrase in _BANNED_SUMMARY_PHRASES:
        if phrase in low:
            issues.append(f"banned_phrase:{phrase}")

    if wc > 350:
        issues.append(f"summary_too_long_words:{wc}")
    if wc < 120 and summary:
        issues.append(f"summary_too_short_words:{wc}")

    if pcount > 4:
        issues.append(f"too_many_paragraphs:{pcount}")

    parts = re.split(r"(?<=[.!?])\s+", summary)
    norm = [re.sub(r"\s+", " ", p).strip().lower() for p in parts if len(p) > 35]
    if norm:
        worst = Counter(norm).most_common(1)[0][1]
        if worst >= 3:
            issues.append("repeated_sentence_pattern")

    hl = draft.highlights or []
    if len(hl) > 5:
        issues.append(f"too_many_highlights:{len(hl)}")

    if strict_title:
        tl = title.lower()
        if any(tl.startswith(p) for p in _GENERIC_TITLE_PREFIXES):
            issues.append("generic_title")

    ok = len(issues) == 0
    return DiaryQualityResult(ok=ok, issues=issues, word_count=wc, paragraph_count=pcount)


def sanitize_diary_draft(draft: DiaryLLMPlan) -> DiaryLLMPlan:
    """Remove obvious log fragments and trim highlights."""
    summary = draft.summary or ""
    low = summary.lower()
    for phrase in _BANNED_SUMMARY_PHRASES:
        if phrase in low:
            # strip lines containing phrase
            lines = [ln for ln in summary.split("\n") if phrase not in ln.lower()]
            summary = "\n\n".join(lines)
            low = summary.lower()
    highlights = [str(h).strip() for h in (draft.highlights or []) if str(h).strip()][:5]
    themes = [str(t).strip() for t in (draft.themes or []) if str(t).strip()][:5]
    return draft.model_copy(update={"summary": summary.strip(), "highlights": highlights, "themes": themes})
