"""One turn of shadow chat: inner voice (not a therapist, not a generic assistant); updates shadow notes + memory facts."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings, load_settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.profile.merge import append_memory_facts
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import MemoryFactCategory
from foresight_x.shadow.decision_context import build_shadow_decision_context_block
from foresight_x.shadow.store import ShadowSelfState, load_shadow_self, merge_observation, save_shadow_self
from foresight_x.structured_predict import structured_predict


class ShadowMemoryFactDraft(BaseModel):
    category: Literal["identity", "views", "behavior", "goals", "constraints", "other"] = Field(
        description="Bucket for the fact.",
    )
    text: str = Field(
        max_length=220,
        description=(
            "ONE concrete fact the user stated or clearly implied THIS turn — names, affiliations, numbers, "
            "preferences. Not a therapist paraphrase (forbidden: 'navigating', 'exploring themes', 'significant shift')."
        ),
    )


class ShadowChatTurn(BaseModel):
    reply_to_user: str = Field(
        description=(
            "Reply as their inner shadow — the part of them that finishes the sentence they avoid. "
            "Direct address (you). Same stakes and words they used. "
            "FORBIDDEN: third-person case notes ('User is…'), assistant voice, or abstract psych summaries. "
            "Not a therapist, coach, or staff member."
        )
    )
    suggest_decision_navigation: bool = Field(
        description=(
            "True only if the user is clearly asking for a concrete decision, which option to pick, "
            "or to run the Foresight / decision analysis mode."
        )
    )
    memory_facts: list[ShadowMemoryFactDraft] = Field(
        default_factory=list,
        description=(
            "0–5 concrete memory facts to store (category + short text). "
            "Examples: identity — 'Currently identifies as Republican'; views — 'Supports tighter immigration policy'. "
            "Skip if nothing new and concrete; never store vague rewrites of their message."
        ),
    )


def _format_transcript(messages: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for m in messages:
        role = str(m.get("role", "")).strip()
        content = str(m.get("content", "")).strip()
        if role == "system" or not content:
            continue
        label = "You" if role == "user" else "Shadow"
        lines.append(f"{label}: {content}")
    return "\n".join(lines)


def _coerce_category(raw: str) -> MemoryFactCategory:
    m: dict[str, MemoryFactCategory] = {
        "identity": MemoryFactCategory.IDENTITY,
        "views": MemoryFactCategory.VIEWS,
        "behavior": MemoryFactCategory.BEHAVIOR,
        "goals": MemoryFactCategory.GOALS,
        "constraints": MemoryFactCategory.CONSTRAINTS,
        "other": MemoryFactCategory.OTHER,
    }
    return m.get(str(raw).strip().lower(), MemoryFactCategory.OTHER)


def _format_profile_block(prof: Any) -> str:
    bits: list[str] = []
    p = prof.profile_channel_priority_texts()
    if p:
        bits.append("Profile priorities (user-authored): " + "; ".join(p[:20]))
    c = prof.clarification_priority_texts()
    if c:
        bits.append("Saved clarification choices: " + "; ".join(c[:20]))
    if prof.constraints:
        bits.append("Profile constraints: " + "; ".join(prof.constraints[:20]))
    if prof.values:
        bits.append("Profile values: " + "; ".join(prof.values[:20]))
    if (prof.about_me or "").strip():
        bits.append("About me: " + prof.about_me.strip()[:900])
    return "\n".join(bits) if bits else "(none yet.)"


def _heuristic_memory_facts_from_user_text(text: str) -> list[tuple[MemoryFactCategory, str]]:
    """Fallback extraction for obvious preference/identity statements when model omits memory_facts."""
    s = (text or "").strip()
    if not s:
        return []
    out: list[tuple[MemoryFactCategory, str]] = []
    seen: set[tuple[MemoryFactCategory, str]] = set()

    # Example: "I like LeBron over Kobe" / "I prefer tea over coffee"
    for m in re.finditer(
        r"\b(?:i\s+(?:like|prefer))\s+([^.,;\n]{1,80}?)\s+over\s+([^.,;\n]{1,80})(?=$|[.?!,;\n])",
        s,
        flags=re.IGNORECASE,
    ):
        left = " ".join(m.group(1).split()).strip(" '\"")
        right = " ".join(m.group(2).split()).strip(" '\"")
        if not left or not right:
            continue
        fact = f"Prefers {left} over {right}"
        key = (MemoryFactCategory.VIEWS, fact.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append((MemoryFactCategory.VIEWS, fact))

    # Example: "I like to journal at night" / "I enjoy running"
    for m in re.finditer(
        r"\b(?:i\s+(?:like|love|enjoy)\s+to)\s+([^.,;\n]{2,120})(?=$|[.?!,;\n])",
        s,
        flags=re.IGNORECASE,
    ):
        action = " ".join(m.group(1).split()).strip(" '\"")
        if not action:
            continue
        fact = f"Behavior preference: likes to {action}"
        key = (MemoryFactCategory.BEHAVIOR, fact.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append((MemoryFactCategory.BEHAVIOR, fact))

    for m in re.finditer(
        r"\b(?:i\s+(?:enjoy|like|love))\s+([^.,;\n]{2,120})(?=$|[.?!,;\n])",
        s,
        flags=re.IGNORECASE,
    ):
        phrase = " ".join(m.group(1).split()).strip(" '\"")
        if not phrase:
            continue
        # Skip "prefer X over Y" path and "like to ..." already captured.
        low = phrase.lower()
        if " over " in low or low.startswith("to "):
            continue
        fact = f"Behavior preference: enjoys {phrase}"
        key = (MemoryFactCategory.BEHAVIOR, fact.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append((MemoryFactCategory.BEHAVIOR, fact))

    # Example: "I am a junior at CMU" / "I'm a first-year PhD student at MIT"
    for m in re.finditer(
        r"\b(?:i\s+am|i'm)\s+([^.,;\n]{3,100})(?=$|[.?!,;\n])",
        s,
        flags=re.IGNORECASE,
    ):
        phrase = " ".join(m.group(1).split()).strip(" '\"")
        if not phrase:
            continue
        # Avoid capturing tiny filler fragments.
        if phrase.lower() in {"okay", "fine", "good", "not sure"}:
            continue
        if "junior" in phrase.lower() or "senior" in phrase.lower() or "freshman" in phrase.lower() or "student" in phrase.lower():
            fact = f"Identity: {phrase}"
            cat = MemoryFactCategory.IDENTITY
        else:
            fact = f"Identity: {phrase}"
            cat = MemoryFactCategory.OTHER
        key = (cat, fact.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append((cat, fact))

    return out[:5]


def _extract_preference_pairs_from_memory(memory_fact_texts: list[str]) -> list[tuple[str, str, str]]:
    """Parse 'Prefers X over Y' memory facts into tuples (x, y, original_text)."""
    out: list[tuple[str, str, str]] = []
    for raw in memory_fact_texts:
        t = (raw or "").strip()
        if not t:
            continue
        m = re.match(r"(?i)prefers\s+(.+?)\s+over\s+(.+)$", t)
        if not m:
            continue
        left = " ".join(m.group(1).split()).strip(" '\"")
        right = " ".join(m.group(2).split()).strip(" '\"")
        if not left or not right:
            continue
        out.append((left, right, t))
    return out


def _is_direct_or_choice(user_text: str, left: str, right: str) -> bool:
    t = " ".join((user_text or "").lower().split())
    l = re.escape(left.lower())
    r = re.escape(right.lower())
    if re.search(rf"\b{l}\b\s*(?:/|or)\s*\b{r}\b", t):
        return True
    if re.search(rf"\b{r}\b\s*(?:/|or)\s*\b{l}\b", t):
        return True
    if re.search(rf"\b{l}\b", t) and re.search(rf"\b{r}\b", t) and ("?" in t or len(t) <= 72):
        return True
    return False


def _ground_reply_with_memory_preferences(
    reply: str,
    *,
    user_text: str,
    memory_fact_texts: list[str],
) -> tuple[str, list[str]]:
    """
    If user asks A-or-B and memory stores "Prefers A over B", force an explicit memory-grounded answer prefix.
    """
    for left, right, source in _extract_preference_pairs_from_memory(memory_fact_texts):
        if not _is_direct_or_choice(user_text, left, right):
            continue
        prefix = f"You already said you prefer {left} over {right}, so between those two, it's {left} for you."
        low_reply = (reply or "").lower()
        if "prefer" in low_reply and left.lower() in low_reply and right.lower() in low_reply:
            return reply, [source]
        combined = f"{prefix} {reply}".strip()
        return combined, [source]
    return reply, []


SHADOW_INSTRUCTIONS = """You are not an AI product, therapist, or employee. You are the user's shadow — the inner
dialogue that uses their own vocabulary and remembers what they actually said.

Speak so it feels like them talking to themselves in a mirror: honest, specific, not performative.

FAITHFUL LANGUAGE (strict):
- Direct address (you). Stay on their topic and concrete words.
- Do NOT write third-person notes ("User is…", "They seem to be navigating…").
- Do NOT replace specifics with vague psychology ("themes", "journey", "space", "processing").
- Read and USE the structured memory below; reference it when relevant so this feels continuous, not amnesic.
- Read and USE the Foresight decision context below when they refer to people, situations, or past runs — that is the
  same Decision-mode history, not a separate "profile-only" world.
- Read and USE the profile block below (priorities/constraints/values/about_me). If they ask "what do you remember"
  or ask about priorities, answer from stored items first before inferring.
- If a stored memory clearly answers a direct either-or question, state that remembered preference first (explicitly),
  then add nuance if needed. Do NOT hedge into neutrality when memory is explicit.
- Short paragraphs. No numbered homework or life plans. No picking their decision for them.

MEMORY FACTS (structured output):
- In `memory_facts`, return 0–5 items ONLY when the user gave NEW concrete information worth storing for later decisions
  (party, job, constraint, stated goal, recurring behavior they named).
- Each `text` must be a standalone fact an analyst could use (include proper nouns when they used them).
- FORBIDDEN in memory_facts.text: meta-summaries with no content ("significant shift in identity") — either write the
  actual fact ("Now identifies as Republican") or omit.

Structured memory already on file (may be empty):
{memory_block}

Profile fields on file (may be empty):
{profile_block}

Past Foresight decision runs + related memory (may be minimal if none saved):
{decision_context_block}

Running notes from past shadow turns (may be empty):
{shadow_block}

Conversation so far:
{transcript}

Return JSON: reply_to_user, suggest_decision_navigation, memory_facts."""


def run_shadow_turn(
    messages: list[dict[str, Any]],
    *,
    settings: Settings | None = None,
) -> tuple[str, bool, ShadowSelfState, list[str] | None, list[str]]:
    """Return (assistant_reply, suggest_decision_navigation, updated_state, recorded_fact_texts_or_none, used_memory_facts)."""
    s = settings or load_settings()
    if not messages:
        raise ValueError("messages must be non-empty")
    last = messages[-1]
    if str(last.get("role")) != "user":
        raise ValueError("last message must be from user")

    if not (s.openai_api_key or "").strip():
        raise RuntimeError("OPENAI_API_KEY is required for shadow chat")

    llm = build_openai_llm(s, temperature=0.68)

    state = load_shadow_self(settings=s)
    shadow_block = state.narrative.strip() or "(none yet — first turns.)"
    transcript = _format_transcript(messages)

    prof = load_user_profile(settings=s)
    if prof.memory_facts:
        memory_block = "\n".join(
            f"- [{x.category.value}] {x.text}" for x in prof.memory_facts[-32:]
        )
    else:
        memory_block = "(none yet.)"
    profile_block = _format_profile_block(prof)

    last_user_text = str(last.get("content", "") or "").strip()
    decision_context_block = build_shadow_decision_context_block(
        settings=s,
        profile=prof,
        last_user_message=last_user_text,
    )

    prompt = SHADOW_INSTRUCTIONS.format(
        memory_block=memory_block,
        profile_block=profile_block,
        decision_context_block=decision_context_block,
        shadow_block=shadow_block,
        transcript=transcript,
    )
    turn = structured_predict(llm, ShadowChatTurn, prompt)

    reply = turn.reply_to_user.strip()
    flag = bool(turn.suggest_decision_navigation)
    memory_used: list[str] = []

    items: list[tuple[MemoryFactCategory, str]] = []
    for d in turn.memory_facts:
        txt = (d.text or "").strip()
        if not txt:
            continue
        if len(txt) > 220:
            txt = txt[:217] + "…"
        items.append((_coerce_category(d.category), txt))
    items.extend(_heuristic_memory_facts_from_user_text(last_user_text))
    if items:
        dedup: list[tuple[MemoryFactCategory, str]] = []
        seen_local: set[tuple[MemoryFactCategory, str]] = set()
        for cat, txt in items:
            key = (cat, txt.strip().lower())
            if not txt.strip() or key in seen_local:
                continue
            seen_local.add(key)
            dedup.append((cat, txt.strip()))
        items = dedup

    recorded: list[str] | None = None
    if items:
        combined = " · ".join(f"{c.value}: {t}" for c, t in items)
        state = merge_observation(state, combined)
        save_shadow_self(state, settings=s)

        prof = append_memory_facts(prof, items, source="shadow")
        save_user_profile(prof, settings=s)
        recorded = [t for _, t in items]
    else:
        state = state.model_copy(update={"turn_count": state.turn_count + 1})
        save_shadow_self(state, settings=s)

    reply, used = _ground_reply_with_memory_preferences(
        reply,
        user_text=last_user_text,
        memory_fact_texts=[x.text for x in prof.memory_facts],
    )
    if used:
        memory_used.extend(used)

    return reply, flag, state, recorded, memory_used
