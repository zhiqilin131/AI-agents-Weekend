"""Sanitize Slime-facing identity text (names, persona strings) — blocks injections and unsafe themes."""

from __future__ import annotations

import re
import unicodedata
from typing import Final

# Instruction hijacks / memory-confusion attacks (substring match, normalized lower).
_UNSAFE_IDENTITY_PHRASES: Final[tuple[str, ...]] = (
    "pretend you are the user",
    "pretend you're the user",
    "you are the user",
    "you're the user",
    "act as the user",
    "your memories are my memories",
    "my memories are yours",
    "never clarify",
    "do not clarify",
    "don't clarify",
    "ignore safety",
    "bypass safety",
    "bypass confirmation",
    "no confirmation",
    "without confirmation",
    "override safety",
    "jailbreak",
    "system prompt",
)

_SELF_HARM_RE = re.compile(
    r"\b(suicid|kill\s+myself|self[\s-]*harm|cut\s+myself|end\s+my\s+life)\b",
    re.I,
)

_EXPLICIT_SEXUAL_RE = re.compile(
    r"\b(porn|xxx|nsfw|blowjob|handjob|cumshot|rape\b)\b",
    re.I,
)

# Severe hate / slur roots (unicode-normalized lower); conservative identity-field filter.
_SLURISH_TOKEN_RES: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"n[i1l][g9]{2}[e3a@][rR]", re.I),
    re.compile(r"f[a@4][g9]{2}[o0][tT]", re.I),
    re.compile(r"k[i1]ke\b", re.I),
    re.compile(r"ch[i1]nk\b", re.I),
    re.compile(r"\bspic\b", re.I),
    re.compile(r"\bcoon\b", re.I),
)

_SAFE_SLIME_NAME_FALLBACK = "your Slime Buddy"


def _normalize_identity_scan(text: str) -> str:
    s = unicodedata.normalize("NFKC", text or "").lower()
    s = "".join(ch for ch in s if ch.isprintable())
    return " ".join(s.split())


def contains_unsafe_identity_phrase(text: str) -> bool:
    low = _normalize_identity_scan(text)
    return any(p in low for p in _UNSAFE_IDENTITY_PHRASES)


def contains_blocked_identity_theme(text: str) -> bool:
    """Self-harm, explicit sexual, or common slur-shaped tokens."""
    low = _normalize_identity_scan(text)
    if _SELF_HARM_RE.search(low):
        return True
    if _EXPLICIT_SEXUAL_RE.search(low):
        return True
    for rx in _SLURISH_TOKEN_RES:
        if rx.search(low):
            return True
    return False


def is_safe_slime_display_name(raw: str) -> bool:
    name = (raw or "").strip()
    if not name or len(name) > 24:
        return False
    low = _normalize_identity_scan(name)
    if contains_unsafe_identity_phrase(low):
        return False
    if contains_blocked_identity_theme(low):
        return False
    if re.search(r"https?://", low):
        return False
    if "<script" in low or "</script>" in low:
        return False
    printable_ratio = sum(1 for c in name if c.isalnum() or c.isspace()) / max(len(name), 1)
    if printable_ratio < 0.45:
        return False
    return True


def sanitize_role_identity_text(raw: str, *, max_len: int = 500) -> str:
    s = str(raw or "").strip().replace("\n", " ")
    if not s:
        return (
            "A personal decision companion that helps the user think clearly, remember context, "
            "and turn decisions into action."
        )
    if contains_unsafe_identity_phrase(s) or contains_blocked_identity_theme(s):
        return (
            "A personal companion agent that helps the user remember, decide, plan, and act — "
            "without overriding safety or confirmation rules."
        )
    return s[:max_len]


def sanitize_user_nickname_text(raw: str | None, *, max_len: int = 24) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if contains_unsafe_identity_phrase(s) or contains_blocked_identity_theme(s):
        return None
    return s[:max_len]

