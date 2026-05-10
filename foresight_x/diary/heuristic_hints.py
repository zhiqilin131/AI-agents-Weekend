"""Concrete topic snippets from cleaned previews (not full transcripts)."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from foresight_x.diary.diary_clean import is_boilerplate_preview
from foresight_x.diary.schemas import DiarySourceBundle


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip()).lower()[:320]


def clip_first_chunk(text: str, max_len: int = 105) -> str:
    """Prefer first clause/sentence; trim on word boundary."""
    t = (text or "").strip()
    if not t:
        return ""
    for sep in (". ", "? ", "! ", "\n"):
        idx = t.find(sep)
        if 12 <= idx <= max_len + 35:
            chunk = t[: idx + 1].strip()
            return chunk[:max_len].rsplit(" ", 1)[0] if len(chunk) > max_len else chunk
    if len(t) <= max_len:
        return t
    return t[:max_len].rsplit(" ", 1)[0]


def collect_concrete_hints(
    cleaned: DiarySourceBundle,
    *,
    calendar_titles: list[str],
    limit: int = 6,
) -> list[str]:
    """Pick diverse short snippets from chat/voice — specific, not bulk pasted logs."""
    cal_low = {ct.lower().strip() for ct in calendar_titles if len(ct.strip()) > 4}
    hints: list[str] = []
    prev_norms: list[str] = []

    pairs: list[str] = [m.preview for m in cleaned.chat_messages] + [v.preview for v in cleaned.voice_turns]

    for raw in pairs:
        t = (raw or "").strip()
        if len(t) < 18:
            continue
        if is_boilerplate_preview(t):
            continue
        if "repeated naming" in t.lower():
            continue
        tl = t.lower()
        if any(cal in tl for cal in cal_low if len(cal) > 6):
            continue

        chunk = clip_first_chunk(t, 105)
        if len(chunk) < 18:
            continue
        cn = _norm(chunk)
        if any(SequenceMatcher(None, cn, pn).ratio() >= 0.82 for pn in prev_norms):
            continue
        hints.append(chunk)
        prev_norms.append(cn)
        if len(hints) >= limit:
            break

    return hints


def clip_decision_preview(text: str, max_len: int = 140) -> str:
    return clip_first_chunk(text, max_len)


def clip_memory_preview(text: str, max_len: int = 120) -> str:
    return clip_first_chunk(text, max_len)
