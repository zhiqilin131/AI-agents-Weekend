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

_PLACEHOLDER_TITLES = frozenset({"new chat", "therapy session", "chat", ""})


class _ThreadTitleOut(BaseModel):
    title: str = Field(..., min_length=2, max_length=80)


def _normalize_title(raw: str) -> str:
    t = " ".join((raw or "").strip().split())
    t = t.strip("\"'“”‘’`")
    if t.endswith((".", "!", "?")):
        t = t[:-1].rstrip()
    return t[:64]


def is_placeholder_thread_title(title: str | None) -> bool:
    return (title or "").strip().lower() in _PLACEHOLDER_TITLES


_LEADING_GREETING = re.compile(r"^(?:hi|hello|hey)[,.!]?\s*", re.I)
_SO_PREFIX = re.compile(r"^so\s+", re.I)
_GREETING_OPENER = re.compile(
    r"^(?:my name is|i am)\s+[\w\s'-]{1,40}(?:\s+and\s+|\s*,\s*)",
    re.I,
)
_I_AM_OPENER = re.compile(r"^i'm\s+", re.I)


def heuristic_thread_title(first_message: str = "") -> str:
    """Fast fallback when LLM is unavailable — compress to a short topic label, not a copy."""
    t = " ".join((first_message or "").strip().split())
    for pat in _STRIP_PREFIXES:
        t = pat.sub("", t).strip()
    t = _LEADING_GREETING.sub("", t).strip()
    t = _SO_PREFIX.sub("", t).strip()
    t = _GREETING_OPENER.sub("", t).strip()
    t = _I_AM_OPENER.sub("", t).strip()
    if not t:
        return "New chat"
    norm = _normalize_title(t)
    words = norm.split()
    if len(words) > 8:
        norm = " ".join(words[:8])
    if len(norm) > 56:
        return norm[:56] + "…"
    return norm


def _is_first_user_turn(thread: dict[str, Any]) -> bool:
    return sum(1 for m in thread.get("messages", []) if str(m.get("role") or "") == "user") == 1


def _first_user_message_content(thread: dict[str, Any]) -> str:
    for m in thread.get("messages") or []:
        role = str(m.get("role") or "").strip().lower()
        if role in ("user", "human"):
            return str(m.get("content") or "").strip()
    return ""


def _first_assistant_message_content(thread: dict[str, Any]) -> str:
    for m in thread.get("messages") or []:
        role = str(m.get("role") or "").strip().lower()
        if role in ("assistant", "ai", "model"):
            return str(m.get("content") or "").strip()
    return ""


def _therapy_session_blob(thread: dict[str, Any]) -> str:
    therapy = thread.get("therapy_session")
    if not isinstance(therapy, dict):
        therapy = thread.get("wellbeing_session")
    if not isinstance(therapy, dict):
        return ""
    concern = str(therapy.get("primary_concern") or "").strip()
    goal = str(therapy.get("session_goal") or "").strip()
    note = str(therapy.get("optional_note") or "").strip()
    parts = [p for p in (concern, goal, note) if p]
    return "\n".join(parts)


def summarize_therapy_thread_title(source_text: str, llm: Any | None = None) -> str:
    text = (source_text or "").strip()
    if not text:
        return "Therapy session"
    fallback = heuristic_thread_title(text)
    if fallback == "New chat":
        fallback = "Therapy session"
    if llm is None:
        return fallback
    try:
        prompt = (
            "You label therapy support chat threads in a sidebar. Given a check-in or the user's "
            "first message, write a short topic label (3–8 words) that summarizes the emotional theme "
            "or life situation — not the first sentence verbatim.\n"
            "- Focus on what they are going through (stress, breakup, sleep, grief), not meta phrases.\n"
            "- Use the same language as the user.\n"
            "- No quotes, no trailing punctuation.\n"
            "- Example: 'I can't sleep and I'm stressed about work' → Work stress and sleep\n\n"
            f"Context:\n{text[:2000]}\n"
        )
        out = structured_predict(llm, _ThreadTitleOut, prompt)
        parsed = out if isinstance(out, _ThreadTitleOut) else _ThreadTitleOut.model_validate(out)
        title = _normalize_title(parsed.title)
        if len(title) < 2:
            return fallback
        return title
    except Exception:
        _log.debug("therapy thread title LLM summarization failed; using heuristic", exc_info=True)
        return fallback


def summarize_thread_title(
    first_message: str,
    llm: Any | None = None,
    *,
    slime_type: str | None = None,
) -> str:
    st = (slime_type or "generalized").strip().lower()
    if st == "wellbeing":
        return summarize_therapy_thread_title(first_message, llm)
    return summarize_thread_title_decision(first_message, llm)


def summarize_thread_title_decision(first_message: str, llm: Any | None = None) -> str:
    text = (first_message or "").strip()
    if not text:
        return "New chat"
    fallback = heuristic_thread_title(text)
    if llm is None:
        return fallback
    try:
        prompt = (
            "You label chat threads in a sidebar. Summarize ONLY the USER's first message below.\n"
            "Rules:\n"
            "- Write 3–8 words describing the user's topic or decision — not Mochi's reply.\n"
            "- Do NOT quote or paraphrase the assistant. You have not seen the assistant reply.\n"
            "- Do NOT copy the user's sentence verbatim; compress to a short topic label.\n"
            "- Ignore meta phrases like 'help me decide' or 'I answered that already' — infer the subject.\n"
            "- Use the same language as the user.\n"
            "- No quotes, no trailing punctuation.\n"
            "- Example user: 'Help me decide: Should I sleep with my girlfriend tonight?' → "
            "Girlfriend sleepover tonight\n"
            "- Example user: 'I answered that a long time ago' (about homework) → Prior homework answer\n\n"
            f"USER first message only:\n{text[:2000]}\n"
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


def _title_is_verbatim_user_opener(stored: str, first: str) -> bool:
    """True when the stored title is still a copy/truncation of the user's first message."""
    s = " ".join((stored or "").strip().split())
    f = " ".join((first or "").strip().split())
    if not s or not f:
        return False
    sl = s.rstrip("…...").rstrip().lower()
    fl = f.lower()
    if sl == fl:
        return True
    if len(s) >= 18 and (fl.startswith(sl) or sl in fl):
        return True
    h = heuristic_thread_title(first)
    if s == h or sl == h.lower():
        return True
    return False


def _stored_title_reflects_first_message(stored: str, first: str) -> bool:
    """True when the sidebar title is already a summarized label from the first user turn."""
    if not stored or not first:
        return False
    if _title_is_verbatim_user_opener(stored, first):
        return False
    if stored == heuristic_thread_title(first):
        return False
    stop = frozenset(
        {
            "about",
            "that",
            "this",
            "with",
            "from",
            "have",
            "just",
            "really",
            "very",
            "your",
            "what",
            "when",
            "where",
            "would",
            "could",
            "should",
        }
    )
    stored_words = {w for w in stored.lower().split() if len(w) > 3 and w not in stop}
    first_words = {w for w in first.lower().split() if len(w) > 3 and w not in stop}
    if not stored_words or not first_words:
        return False
    return bool(stored_words & first_words)


def _title_matches_intake_category(thread: dict[str, Any], stored: str) -> bool:
    """True when title is still a generic intake label, not a summarized first turn."""
    therapy = thread.get("therapy_session")
    if not isinstance(therapy, dict):
        therapy = thread.get("wellbeing_session")
    if not isinstance(therapy, dict):
        return False
    for field in ("primary_concern", "session_goal"):
        raw = str(therapy.get(field) or "").strip()
        if not raw:
            continue
        if stored.lower() == raw.lower():
            return True
        if stored == heuristic_thread_title(raw):
            return True
    return False


def title_needs_refresh(thread: dict[str, Any]) -> bool:
    """Whether stored title should be replaced with a summarized label."""
    stored = (thread.get("title") or "").strip()
    if is_placeholder_thread_title(stored):
        return True
    if len(stored) > 52:
        return True
    first = _first_user_message_content(thread)
    if first and stored == heuristic_thread_title(first):
        return True
    if _title_matches_intake_category(thread, stored):
        return True
    if first and not _stored_title_reflects_first_message(stored, first):
        return True
    if _title_looks_like_assistant_reply(stored, thread):
        return True
    if first and _title_is_verbatim_user_opener(stored, first):
        return True
    return False


def title_needs_wellbeing_refresh(thread: dict[str, Any]) -> bool:
    """Backward-compatible alias for wellbeing-specific callers/tests."""
    return title_needs_refresh(thread)


def _title_looks_like_assistant_reply(title: str, thread: dict[str, Any]) -> bool:
    """Reject titles that were likely derived from Mochi's first reply."""
    t = (title or "").strip().lower()
    if not t:
        return False
    assistant = _first_assistant_message_content(thread).lower()
    if not assistant:
        return False
    if len(t) >= 12 and t in assistant[:400]:
        return True
    opener_phrases = (
        "it sounds like",
        "i'm really sorry",
        "i am really sorry",
        "let me help",
        "i hear you",
        "that makes sense",
    )
    return any(t.startswith(p) for p in opener_phrases)


def resolve_thread_title(thread: dict[str, Any], llm: Any | None = None) -> str:
    """Display/persist title — summarize the user's first message, never the assistant reply."""
    st = str(thread.get("slime_type") or "generalized").strip().lower()
    default = "Therapy session" if st == "wellbeing" else "New chat"
    stored = (thread.get("title") or "").strip() or default
    first = _first_user_message_content(thread)
    if first:
        obvious_bad = (
            is_placeholder_thread_title(stored)
            or len(stored) > 52
            or _title_looks_like_assistant_reply(stored, thread)
            or _title_is_verbatim_user_opener(stored, first)
            or _title_matches_intake_category(thread, stored)
        )
        # List endpoints often run without an LLM. If a prior turn already produced a
        # real summarized title, keep it instead of downgrading to the heuristic opener.
        if not obvious_bad and thread.get("title_source") == "first_user_turn":
            return stored
        if llm is None and not obvious_bad:
            return stored
        if llm is not None or obvious_bad or not _stored_title_reflects_first_message(stored, first):
            return summarize_thread_title(first, llm, slime_type=st)
        return summarize_thread_title(first, llm, slime_type=st)
    return stored if not is_placeholder_thread_title(stored) else default


def resolve_wellbeing_thread_title(thread: dict[str, Any], llm: Any | None = None) -> str:
    """Display/persist title for wellbeing threads (first user turn, then intake)."""
    return resolve_thread_title(thread, llm)


def apply_title_from_wellbeing_intake(
    thread: dict[str, Any],
    *,
    llm: Any | None = None,
) -> str | None:
    """Check-in does not set sidebar titles — wait for the first spoken/chat turn."""
    _ = llm
    if _first_user_message_content(thread):
        return None
    current = (thread.get("title") or "").strip()
    if is_placeholder_thread_title(current):
        return None
    return None


def refine_thread_title_first_turn(
    thread: dict[str, Any],
    user_message: str = "",
    *,
    llm: Any | None = None,
) -> str | None:
    """Summarize title from the user's first message (heuristic or LLM)."""
    first = _first_user_message_content(thread) or (user_message or "").strip()
    if first:
        applied = apply_title_for_first_user_message(
            thread,
            first,
            llm=llm,
            slime_type=str(thread.get("slime_type") or "generalized"),
        )
        if applied:
            return applied
    return maybe_refresh_thread_title(thread, llm=llm)


def maybe_refresh_thread_title(
    thread: dict[str, Any],
    *,
    llm: Any | None = None,
) -> str | None:
    first = _first_user_message_content(thread)
    if not first and not title_needs_refresh(thread):
        return None
    new_title = resolve_thread_title(thread, llm)
    current = (thread.get("title") or "").strip()
    if not new_title or new_title == current:
        return None
    thread["title"] = new_title
    return new_title


def sync_list_thread_title(thread: dict[str, Any], *, llm: Any | None = None) -> str:
    """Resolve display title for thread lists; mutates ``thread['title']`` when upgraded."""
    display = resolve_thread_title(thread, llm)
    current = (thread.get("title") or "").strip()
    if display and display != current:
        thread["title"] = display
        if llm is not None and not _title_is_verbatim_user_opener(display, _first_user_message_content(thread)):
            thread["title_source"] = "first_user_turn"
    return display


def maybe_refresh_wellbeing_thread_title(
    thread: dict[str, Any],
    *,
    llm: Any | None = None,
) -> str | None:
    slime = str(thread.get("slime_type") or "").strip().lower()
    if slime != "wellbeing":
        return None
    return maybe_refresh_thread_title(thread, llm=llm)


def apply_title_for_first_user_message(
    thread: dict[str, Any],
    content: str,
    *,
    llm: Any | None = None,
    slime_type: str | None = None,
) -> str | None:
    """Set sidebar title from the first user message (heuristic or LLM)."""
    if not _is_first_user_turn(thread):
        return None
    st = (slime_type or thread.get("slime_type") or "generalized").strip().lower()
    current = (thread.get("title") or "New chat").strip()
    if llm is None and not title_needs_refresh(thread) and not is_placeholder_thread_title(current):
        return None
    first_user = _first_user_message_content(thread) or (content or "").strip()
    if not first_user:
        return None
    new_title = summarize_thread_title(first_user, llm, slime_type=st)
    if not new_title or new_title in ("New chat",) or is_placeholder_thread_title(new_title):
        return None
    if _title_looks_like_assistant_reply(new_title, thread):
        new_title = heuristic_thread_title(first_user)
    if new_title == current:
        return None
    thread["title"] = new_title
    if llm is not None and new_title != heuristic_thread_title(first_user):
        thread["title_source"] = "first_user_turn"
    return new_title
