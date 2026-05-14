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
        "into",
        "over",
        "under",
        "many",
        "more",
        "most",
        "much",
        "like",
        "than",
        "then",
        "there",
        "here",
        "each",
        "every",
        "across",
    }
)


def _needle_for_overlap(user_state: UserState, tavily_query: str) -> str:
    raw = (user_state.raw_input or "").strip()
    if raw:
        return raw
    goals = " ".join(user_state.goals or []).strip()
    if goals:
        return goals
    return (tavily_query or "").strip()


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


def _core_query_tokens(text: str) -> tuple[set[str], set[str]]:
    words = {w for w in re.findall(r"[a-zA-Z]{4,}", text.lower()) if w not in _STOP_EN}
    cjk = {seg for seg in re.findall(r"[\u4e00-\u9fff]{2,}", text)}
    return words, cjk


def _anchor_tokens(text: str) -> set[str]:
    # Proper nouns, acronyms, and IDs/numbers are strong anchors.
    caps = {x.lower() for x in re.findall(r"\b[A-Z][A-Za-z0-9+._-]{2,}\b", text)}
    acr = {x.lower() for x in re.findall(r"\b[A-Z]{2,}\b", text)}
    nums = {x.lower() for x in re.findall(r"\b[A-Za-z]*\d+[A-Za-z0-9-]*\b", text)}
    return caps | acr | nums


def _lexical_overlap(needle: str, haystack: str) -> bool:
    """Require meaningful topical overlap, not just one incidental token."""
    n = (needle or "").strip()
    h = (haystack or "").lower()
    if len(n) < 4:
        return True

    words, cjk_segs = _core_query_tokens(n)
    if not words and not cjk_segs:
        return True

    if cjk_segs and not any(seg in h for seg in cjk_segs):
        return False

    # For EN, require either anchor hit or sufficient coverage.
    if words:
        matched = {w for w in words if w in h}
        anchors = _anchor_tokens(n)
        if anchors and not any(a in h for a in anchors):
            return False
        coverage = len(matched) / max(len(words), 1)
        if len(words) <= 2:
            return coverage >= 0.5
        return coverage >= 0.34

    return True


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
