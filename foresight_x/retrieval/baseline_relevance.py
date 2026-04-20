"""Filter world-knowledge baselines so unrelated cached / stray web hits do not dominate the UI."""

from __future__ import annotations

import re

from foresight_x.schemas import Fact, UserState

# Common Chroma-ingested education-demo noise; drop when the user's question is not academic-shaped.
_STALE_ACADEMIC_MARKERS: tuple[str, ...] = (
    "academic integrity",
    "academic dishonesty",
    "plagiarism policy",
    "honor code",
    "cheating lessons",
    "maintaining academic integrity",
    "resolving allegations of academic",
)

_STOP_EN = frozenset(
    {
        "that",
        "this",
        "with",
        "from",
        "your",
        "have",
        "what",
        "when",
        "where",
        "should",
        "would",
        "could",
        "about",
        "into",
        "their",
        "there",
        "these",
        "those",
        "them",
        "then",
        "than",
        "very",
        "just",
        "only",
        "also",
        "some",
        "such",
        "will",
        "been",
        "were",
        "being",
    }
)


def _needle_for_overlap(user_state: UserState, tavily_query: str) -> str:
    parts = [
        user_state.raw_input or "",
        " ".join(user_state.goals or []),
        tavily_query or "",
    ]
    return " ".join(parts).strip()


def _stale_academic_blob_not_in_question(fact_text: str, needle: str) -> bool:
    """True if this fact looks like old academic-demo web junk and the user did not ask about school."""
    t = (fact_text or "").lower()
    n = (needle or "").lower()
    if not any(m in t for m in _STALE_ACADEMIC_MARKERS):
        return False
    school_hints = (
        "academic",
        "school",
        "student",
        "university",
        "college",
        "course",
        "gpa",
        "degree",
        "professor",
        "exam",
        "homework",
        "thesis",
    )
    if any(h in n for h in school_hints):
        return False
    return True


def _lexical_overlap(needle: str, haystack: str) -> bool:
    """Require at least one strong signal that the snippet is about the same topic as the question."""
    n = (needle or "").strip()
    h = (haystack or "").lower()
    if len(n) < 4:
        return True

    # English tokens (length >= 4) from the question must appear in the snippet text.
    words = {w for w in re.findall(r"[a-zA-Z]{4,}", n.lower()) if w not in _STOP_EN}
    cjk_segs = re.findall(r"[\u4e00-\u9fff]{2,}", n)
    if not words and not cjk_segs:
        # Very short / numeric prompts — do not strip everything.
        return True

    if words and any(w in h for w in words):
        return True

    for seg in cjk_segs:
        if seg in h:
            return True

    short_kw = {w for w in re.findall(r"[a-zA-Z]{3}", n.lower()) if w not in _STOP_EN}
    if short_kw and any(w in h for w in short_kw):
        return True

    return False


def keep_baseline_fact(
    user_state: UserState,
    fact: Fact,
    *,
    tavily_query: str = "",
) -> bool:
    """Return False when a baseline Fact should be dropped as off-topic vs. this decision."""
    text = fact.text or ""
    needle = _needle_for_overlap(user_state, tavily_query)
    if _stale_academic_blob_not_in_question(text, needle):
        return False
    if _lexical_overlap(needle, text):
        return True
    return False
