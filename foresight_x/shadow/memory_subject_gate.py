"""Separate user-profile memory from slime-companion memory for Slime Buddy turns."""

from __future__ import annotations

import re
from typing import Iterable

from foresight_x.schemas import ProfileMemoryFact

SLIME_SUBJECT_REFS = frozenset(
    {"slime", "slime_companion", "buddy", "companion", "slime_buddy", "companion_agent"}
)

_REMEMBER_HINTS_EN = (
    "remember that",
    "please remember",
    "don't forget",
    "always remember",
    "帮我记住",
    "请记住",
    "不要忘记",
)

_ASSISTANT_VOICE_FRAGMENTS = (
    "little slime buddy",
    "slime buddy",
    "i'm your ",
    "i am your ",
    "your little slime",
)


def _contains_any(hay: str, needles: Iterable[str]) -> bool:
    h = hay.lower()
    return any(n.strip().lower() in h for n in needles if n.strip())


def user_explicitly_addresses_slime_companion(user_message: str, slime_display_name: str) -> bool:
    """
    True when the user is clearly talking *to or about* the companion agent,
    not merely stating facts about themselves.
    """
    raw = (user_message or "").strip()
    if not raw:
        return False
    low = raw.lower()

    markers_en = (
        "your name",
        "your role",
        "rename yourself",
        "rename you",
        "call yourself",
        "who are you",
        "what are you",
        "what's your name",
        "whats your name",
        "slime buddy",
        "little slime",
        "you're a slime",
        "you are a slime",
        "you slime",
        "hey slime",
        "hey buddy",
    )
    markers_zh = ("你的名字", "你叫", "史莱姆", "你这团", "小家伙", "叫你", "你怎么", "你会什么")
    if any(m in low for m in markers_en):
        return True
    if any(m in raw for m in markers_zh):
        return True

    sn = (slime_display_name or "").strip().lower()
    if len(sn) >= 2 and sn in low:
        # User adopting the same display name as the slime for themselves
        if re.search(rf"(?i)\b(i'?m|i am|call me|my name is|my name's)\s+{re.escape(sn)}\b", raw):
            return False
        return True
    return False


def _fact_echoes_assistant_not_user(
    fact_text: str,
    *,
    user_message: str,
    assistant_reply: str,
) -> bool:
    """Drop lines copied from the assistant reply but absent from the user's message."""
    ft = (fact_text or "").strip()
    if len(ft) < 10:
        return False
    um = (user_message or "").strip().lower()
    ar = (assistant_reply or "").strip().lower()
    if not ar:
        return False
    fl = ft.lower()
    if fl not in ar:
        return False
    # Require substantive overlap with user text (avoid dropping legit overlaps)
    if fl in um:
        return False
    return not _contains_any(um, _REMEMBER_HINTS_EN)


def _mentions_slime_name_as_user_identity(
    fact: ProfileMemoryFact,
    slime_names: set[str],
    user_message: str,
) -> bool:
    """True if this looks like 'user's name is <slime>' without the user claiming that name."""
    text = (fact.text or "").strip().lower()
    pred = (fact.predicate or "").strip().lower()
    obj = (fact.object_value or "").strip().lower()
    bucket = " ".join(x for x in (text, pred, obj) if x)

    nameish = "name" in text or pred in (
        "name_is",
        "preferred_name",
        "display_name",
        "legal_name",
        "calls_self",
        "nicknamed",
        "name",
    )
    if not nameish:
        return False

    um = (user_message or "").lower()
    raw = user_message or ""
    for sn in slime_names:
        s = (sn or "").strip().lower()
        if len(s) < 2 or s not in bucket:
            continue
        if re.search(rf"(?i)\b(i'?m|i am|call me|my name is|my name's|name is)\s+{re.escape(s)}\b", um):
            return False
        if s in um and any(k in raw for k in ("我叫", "叫我", "我的名字", "称呼我")):
            return False
        return True
    return False


def _fact_mirrors_assistant_persona_voice(fact_text: str, user_message: str) -> bool:
    low = fact_text.lower()
    um = user_message.lower()
    if not any(p in low for p in _ASSISTANT_VOICE_FRAGMENTS):
        return False
    return not any(p in um for p in _ASSISTANT_VOICE_FRAGMENTS)


def partition_slime_buddy_memory_candidates(
    records: list[ProfileMemoryFact],
    *,
    last_user_text: str,
    slime_display_name: str,
    assistant_reply: str,
) -> list[ProfileMemoryFact]:
    """
    Filter + tag memory rows for Slime Buddy.

    - User rows: autobiographical facts about the human; drops assistant-echo / slime-name confusion.
    - Slime rows: only when ``subject_ref`` is companion-like AND the user clearly addressed the slime.
      Tagged with qualifiers memory_owner=slime_companion for UI and retrieval separation.
    """
    slime_name = (slime_display_name or "").strip() or "Mochi"
    slime_aliases: set[str] = set()
    sn_low = slime_name.strip().lower()
    if len(sn_low) >= 2:
        slime_aliases.add(sn_low)
    targets_slime = user_explicitly_addresses_slime_companion(last_user_text, slime_name)

    out: list[ProfileMemoryFact] = []
    for rec in records:
        subj = (rec.subject_ref or "user").strip().lower()
        if subj in SLIME_SUBJECT_REFS:
            if not targets_slime:
                continue
            q = dict(rec.qualifiers or {})
            q["memory_owner"] = "slime_companion"
            out.append(
                rec.model_copy(
                    update={
                        "qualifiers": q,
                        "subject_ref": "slime_companion",
                    }
                )
            )
            continue

        text = (rec.text or "").strip()
        if _fact_echoes_assistant_not_user(text, user_message=last_user_text, assistant_reply=assistant_reply):
            continue
        if _fact_mirrors_assistant_persona_voice(text, last_user_text):
            continue
        if _mentions_slime_name_as_user_identity(rec, slime_aliases, last_user_text):
            continue

        out.append(rec)
    return out
