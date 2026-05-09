"""Gate profile writes: jokes / hypotheticals stay thread-local."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.profile.memory_structured import normalize_predicate
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile

MemoryDurability = Literal["long_term_profile", "thread_only", "ignore", "needs_confirmation"]
Sensitivity = Literal["normal", "sensitive"]


class MemoryDurabilityResult(BaseModel):
    durability: MemoryDurability
    confidence: float = Field(ge=0.0, le=1.0, default=0.85)
    reason: str = ""
    sensitivity: Sensitivity = "normal"
    is_joke: bool = False
    is_hypothetical: bool = False
    is_roleplay: bool = False


_JOKE_MARKERS = (
    "haha",
    "ha ha",
    "lol",
    "lmao",
    "rofl",
    "jk",
    "just kidding",
    "kidding",
    "only joking",
    "not serious",
    " joking",
    "开玩笑",
    "玩笑",
    "闹着玩",
    "随便说说",
    "我随便",
    "别太当真",
)

_ROLEPLAY_MARKERS = (
    "pretend ",
    "pretend i'm",
    "pretend i am",
    "roleplay",
    "role play",
    "in this scenario",
    "for this scenario",
    "for this chat",
    "wwii",
    "world war",
    "hypothetically",
    "suppose ",
    "assuming ",
    "imagine ",
    "假装",
    "假设",
    "设想一下",
)

_REMEMBER_EXPLICIT = (
    "remember that",
    "please remember",
    "don't forget",
    "always remember",
    "帮我记住",
    "请记住",
    "不要忘记",
    "以后记住",
)

_CORRECTION_MARKERS = (
    "my real name",
    "real name is",
    "actually my name",
    "actually, call me",
    "actually call me",
    "call me ",
    "from now on",
    "prefer to be called",
    "以后就叫我",
    "其实我叫",
    "我的真名",
    "请叫我",
)


_SENSITIVE = (
    "password",
    "ssn",
    "social security",
    "credit card",
    "银行卡",
    "密码",
)


_NAME_PRED_HINTS = frozenset(
    {
        "preferred_name",
        "display_name",
        "legal_name",
        "calls_self",
        "nicknamed",
        "name_is",
        "name",
    }
)


def _contains_any(hay: str, needles: tuple[str, ...]) -> bool:
    h = hay.lower()
    return any(n.strip().lower() in h for n in needles if n.strip())


def _user_signals_playful(user_message: str) -> tuple[bool, bool, bool]:
    u = (user_message or "").strip()
    low = u.lower()
    joke = _contains_any(low, _JOKE_MARKERS) or _contains_any(u, ("开玩笑", "哈哈", "呵呵"))
    role = _contains_any(low, _ROLEPLAY_MARKERS) or _contains_any(u, ("假装", "假设", "角色扮演"))
    hypo = "what if" in low or "假如" in u or "要是" in u
    return joke, role, hypo


def _explicit_remember(user_message: str) -> bool:
    low = (user_message or "").lower()
    return _contains_any(low, _REMEMBER_EXPLICIT)


def _explicit_identity_correction(user_message: str) -> bool:
    low = (user_message or "").lower()
    return _contains_any(low, _CORRECTION_MARKERS) or _contains_any(
        (user_message or "").strip(),
        ("其实我叫", "真名", "以后就叫我"),
    )


def fact_looks_like_identity_name(fact: ProfileMemoryFact) -> bool:
    pred = normalize_predicate(fact.predicate)
    if pred and any(h in pred for h in _NAME_PRED_HINTS):
        return True
    low = (fact.text or "").lower()
    if fact.category == MemoryFactCategory.IDENTITY and "name" in low:
        return True
    return bool(pred == "name" or pred.endswith("_name"))


def _extract_existing_name_tokens(profile: UserProfile) -> set[str]:
    out: set[str] = set()
    for f in profile.memory_facts:
        if f.status != "active":
            continue
        if not fact_looks_like_identity_name(f):
            continue
        ov = (f.object_value or "").strip().lower()
        if ov:
            out.add(ov)
        # crude: capture quoted names in text
        for m in re.finditer(r"name is\s+([^,\n\.]+)", (f.text or "").lower()):
            out.add(m.group(1).strip())
    return {x for x in out if len(x) >= 2}


def _candidate_name_token(fact: ProfileMemoryFact) -> str:
    ov = (fact.object_value or "").strip().lower()
    if ov:
        return ov
    m = re.search(r"name is\s+([^,\n\.]+)", (fact.text or "").lower())
    if m:
        return m.group(1).strip()
    return (fact.text or "").strip().lower()


def classify_memory_durability(
    user_message: str,
    recent_messages: list[dict[str, Any]],
    candidate_fact: str,
    *,
    category_hint: MemoryFactCategory | None = None,
    predicate_hint: str = "",
) -> MemoryDurabilityResult:
    """
    Decide how to treat a candidate profile fact from Shadow extraction.
    Deterministic heuristics first (tests-friendly); no extra LLM call here.
    """
    um = (user_message or "").strip()
    cand = (candidate_fact or "").strip()
    pred_norm = normalize_predicate(predicate_hint)
    joke_u, role_u, hypo_u = _user_signals_playful(um)
    joke_c = _contains_any(cand.lower(), _JOKE_MARKERS)

    if _contains_any(um.lower(), _SENSITIVE) or _contains_any(cand.lower(), _SENSITIVE):
        if not _explicit_remember(um):
            return MemoryDurabilityResult(
                durability="ignore",
                confidence=0.72,
                reason="Sensitive detail without explicit request to remember.",
                sensitivity="sensitive",
                is_joke=False,
                is_hypothetical=hypo_u,
                is_roleplay=role_u,
            )

    if len(cand) < 6:
        return MemoryDurabilityResult(
            durability="ignore",
            confidence=0.55,
            reason="Too short / trivial to persist.",
            is_joke=joke_u,
            is_hypothetical=hypo_u,
            is_roleplay=role_u,
        )

    if role_u or _contains_any(cand.lower(), _ROLEPLAY_MARKERS):
        return MemoryDurabilityResult(
            durability="thread_only",
            confidence=0.88,
            reason="Roleplay or scenario framing — keep in thread only.",
            is_joke=joke_u,
            is_hypothetical=True,
            is_roleplay=True,
        )

    if hypo_u and not _explicit_remember(um):
        return MemoryDurabilityResult(
            durability="thread_only",
            confidence=0.75,
            reason="Hypothetical framing in user message.",
            is_hypothetical=True,
            is_joke=joke_u,
            is_roleplay=role_u,
        )

    # Explicit durable preference / instruction
    if _explicit_remember(um):
        return MemoryDurabilityResult(
            durability="long_term_profile",
            confidence=0.9,
            reason="User explicitly asked to remember.",
            is_joke=False,
            is_hypothetical=False,
            is_roleplay=False,
        )

    # Jokes / playful identity
    looks_identity = (
        category_hint == MemoryFactCategory.IDENTITY
        or "name" in cand.lower()
        or bool(pred_norm and any(h in pred_norm for h in _NAME_PRED_HINTS))
    )
    if joke_u or joke_c:
        if looks_identity:
            return MemoryDurabilityResult(
                durability="thread_only",
                confidence=0.9,
                reason="Playful / joke cue near identity-like fact — not durable profile.",
                is_joke=True,
                is_hypothetical=hypo_u,
                is_roleplay=role_u,
            )
        return MemoryDurabilityResult(
            durability="thread_only",
            confidence=0.78,
            reason="Joking tone — prefer thread-local note.",
            is_joke=True,
            is_hypothetical=hypo_u,
            is_roleplay=role_u,
        )

    # Serious identity without joke markers
    if looks_identity:
        if _explicit_identity_correction(um):
            return MemoryDurabilityResult(
                durability="long_term_profile",
                confidence=0.86,
                reason="Explicit real-name / correction phrasing.",
                is_joke=False,
                is_hypothetical=False,
                is_roleplay=False,
            )
        silly = bool(re.search(r"(king|god|banana|potato|super\s+\w+\s+\w+)", cand.lower()))
        if silly and not _explicit_identity_correction(um):
            return MemoryDurabilityResult(
                durability="needs_confirmation",
                confidence=0.65,
                reason="Identity-like string looks playful or unusual — confirm before profile write.",
                is_joke=False,
                is_hypothetical=False,
                is_roleplay=False,
            )

    return MemoryDurabilityResult(
        durability="long_term_profile",
        confidence=0.7,
        reason="Default to durable when no playful/hypothetical signals.",
        is_joke=False,
        is_hypothetical=hypo_u,
        is_roleplay=role_u,
    )


def identity_merge_conflict(profile: UserProfile, fact: ProfileMemoryFact) -> bool:
    """True when a name-like fact differs from what is already stored on the profile."""
    if not fact_looks_like_identity_name(fact):
        return False
    existing = _extract_existing_name_tokens(profile)
    new_tok = _candidate_name_token(fact)
    if not existing or not new_tok:
        return False
    return new_tok not in existing


def should_confirm_identity_overwrite(profile: UserProfile, fact: ProfileMemoryFact, user_message: str) -> bool:
    """Prefer asking before overwriting stored identity with a different name."""
    if not identity_merge_conflict(profile, fact):
        return False
    return not _explicit_identity_correction(user_message)
