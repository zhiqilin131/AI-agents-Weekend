from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)

_STRIP_PREFIXES = (
    re.compile(r"^help me decide something concrete:\s*", re.I),
    re.compile(r"^help me decide:\s*", re.I),
    re.compile(r"^help me decide\s+", re.I),
    re.compile(r"^activate decision mode\.?\s*", re.I),
    re.compile(r"^i want to (?:reflect on|discuss)\s+", re.I),
)


class _ThreadTitleOut(BaseModel):
    title: str = Field(..., min_length=2, max_length=80)


def _normalize_title(raw: str) -> str:
    t = " ".join((raw or "").strip().split())
    t = t.strip("\"'“”‘’`")
    if t.endswith((".", "!", "?")):
        t = t[:-1].rstrip()
    return t[:64]


def heuristic_thread_title(first_message: str = "") -> str:
    """Fast fallback when LLM is unavailable."""
    t = " ".join((first_message or "").strip().split())
    for pat in _STRIP_PREFIXES:
        t = pat.sub("", t).strip()
    if not t:
        return "New chat"
    norm = _normalize_title(t)
    if len(norm) > 56:
        return norm[:56] + "…"
    return norm


def _is_first_user_turn(thread: dict[str, Any]) -> bool:
    return sum(1 for m in thread.get("messages", []) if str(m.get("role") or "") == "user") == 1


def summarize_thread_title(first_message: str, llm: Any | None = None) -> str:
    text = (first_message or "").strip()
    if not text:
        return "New chat"
    fallback = heuristic_thread_title(text)
    if llm is None:
        return fallback
    try:
        prompt = (
            "You label chat threads in a sidebar. Given the user's FIRST message, write a short topic "
            "label (3–8 words) that summarizes what they are deciding or discussing.\n"
            "- Capture the subject/decision, not meta phrases like 'help me decide'.\n"
            "- Use the same language as the user.\n"
            "- No quotes, no trailing punctuation.\n"
            "- Example: 'Help me decide: Should I sleep with my girlfriend tonight?' → "
            "Girlfriend sleepover tonight\n\n"
            f"User message:\n{text[:2000]}\n"
        )
        out = structured_predict(llm, _ThreadTitleOut, prompt)
        parsed = out if isinstance(out, _ThreadTitleOut) else _ThreadTitleOut.model_validate(out)
        title = _normalize_title(parsed.title)
        if len(title) < 2:
            return fallback
        return title
    except Exception:
        _log.debug("thread title LLM summarization failed; using heuristic", exc_info=True)
        return fallback


def apply_title_for_first_user_message(
    thread: dict[str, Any],
    content: str,
    *,
    llm: Any | None = None,
) -> str | None:
    """Set sidebar title from the first user message (heuristic or LLM)."""
    if not _is_first_user_turn(thread):
        return None
    current = (thread.get("title") or "New chat").strip()
    if llm is None and current != "New chat":
        return None
    new_title = summarize_thread_title(content, llm)
    if not new_title or new_title == "New chat":
        return None
    if new_title == current:
        return None
    thread["title"] = new_title
    return new_title
