"""One turn of shadow chat: inner voice (not a therapist, not a generic assistant); updates shadow notes + memory facts."""

from __future__ import annotations

import logging
import os
import re
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from foresight_x.config import Settings, load_settings
from foresight_x.extraction.atomic_claims import run_atomic_claims
from foresight_x.memory_graph import TemporalGraphMemory
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.profile.memory_structured import active_memory_facts, format_stored_fact_bullet, render_triple_line
from foresight_x.profile.merge import append_profile_memory_records
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact
from foresight_x.shadow.decision_context import build_shadow_decision_context_block
from foresight_x.shadow.memory_durability import (
    MemoryDurabilityResult,
    classify_memory_durability,
    fact_looks_like_identity_name,
    should_confirm_identity_overwrite,
)
from foresight_x.shadow.thread_context import (
    format_recent_conversation_section,
    get_recent_thread_context,
    is_local_context_question,
)
from foresight_x.shadow.store import ShadowSelfState, load_shadow_self, merge_observation, save_shadow_self
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)

_USER_PERSIST_LOCKS: dict[str, threading.Lock] = {}


def _persist_lock_for(user_id: str) -> threading.Lock:
    if user_id not in _USER_PERSIST_LOCKS:
        _USER_PERSIST_LOCKS[user_id] = threading.Lock()
    return _USER_PERSIST_LOCKS[user_id]


def _shadow_profile_persist_sync_enabled() -> bool:
    """When true, write shadow notes + profile in the request thread (tests / debugging)."""
    return os.getenv("SHADOW_PROFILE_PERSIST_SYNC", "").strip().lower() in ("1", "true", "yes")


def _persist_shadow_memory_background(
    settings: Settings,
    records_payload: list[dict[str, Any]],
    observation_combined: str,
    last_user_text: str,
    reply: str,
) -> None:
    """Load-merge-save shadow self + profile; record graph event. Serialized per user."""
    user_id = (settings.foresight_user_id or "demo_user").strip() or "demo_user"
    records = [ProfileMemoryFact.model_validate(r) for r in records_payload]
    lock = _persist_lock_for(user_id)
    try:
        with lock:
            state = load_shadow_self(settings=settings)
            state = merge_observation(state, observation_combined)
            save_shadow_self(state, settings=settings)
            prof = load_user_profile(settings=settings)
            prof = append_profile_memory_records(prof, records)
            save_user_profile(prof, settings=settings)
        if settings.graph_enabled:
            try:
                TemporalGraphMemory(user_id, settings=settings).record_shadow_event(last_user_text, reply)
            except Exception:
                _log.debug("TemporalGraphMemory.record_shadow_event failed", exc_info=True)
    except Exception:
        _log.exception("shadow memory async persist failed user_id=%s", user_id)


def _schedule_shadow_memory_persist(
    settings: Settings,
    records: list[ProfileMemoryFact],
    observation_combined: str,
    last_user_text: str,
    reply: str,
) -> None:
    payload = [r.model_dump(mode="json") for r in records]
    kwargs: dict[str, Any] = {
        "settings": settings,
        "records_payload": payload,
        "observation_combined": observation_combined,
        "last_user_text": last_user_text,
        "reply": reply,
    }
    if _shadow_profile_persist_sync_enabled():
        _persist_shadow_memory_background(**kwargs)
        return
    threading.Thread(
        target=_persist_shadow_memory_background,
        kwargs=kwargs,
        daemon=True,
        name=f"shadow-persist-{settings.foresight_user_id}",
    ).start()


class ShadowMemoryFactDraft(BaseModel):
    category: Literal["identity", "views", "behavior", "goals", "constraints", "other"] = Field(
        description="Bucket for the fact.",
    )
    text: str = Field(
        max_length=280,
        description=(
            "ONE concrete fact (human-readable line). If subject_ref/predicate/object_value are set, "
            "text can mirror the triple in natural language."
        ),
    )
    subject_ref: str = Field(
        default="user",
        description="Entity this is about; default 'user' for first-person statements.",
    )
    predicate: str = Field(
        default="",
        description=(
            "snake_case relation (e.g. studies_at, friend_of, prefers, dating). Use open vocabulary; "
            "empty means legacy flat fact (category+text only)."
        ),
    )
    object_value: str = Field(
        default="",
        description="Object of the relation (school name, person, preference target). Empty if legacy flat.",
    )
    evidence: str = Field(
        default="",
        max_length=220,
        description="Short verbatim quote from the user's latest message supporting this fact (may be empty).",
    )


@dataclass
class ShadowTurnOutput:
    """Structured result from ``run_shadow_turn`` (replaces legacy 5-tuple unpack)."""

    reply: str
    suggest_decision_navigation: bool
    state: ShadowSelfState
    profile_record_texts: list[str] | None
    used_memory_facts: list[str]
    thread_only_items: list[dict[str, Any]] = field(default_factory=list)
    memory_confirmation_question: str | None = None


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
            "0–6 concrete profile rows per turn when the user shares new autobiographical facts (what they did, "
            "where they were, self-image they assert, named people/situations they treat as real, goals, constraints) "
            "or explicit remember / real-name corrections. Downstream code strips jokes, hypotheticals, roleplay, "
            "and sensitive facts unless the user asked to remember — propose serious candidates anyway. "
            "Skip duplicates of facts already in stable memory in the prompt; skip empty meta-summaries."
        ),
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _thread_ctx_type(cls: MemoryDurabilityResult, fact: ProfileMemoryFact) -> str:
    if cls.is_roleplay:
        return "roleplay_setup"
    if cls.is_joke:
        return "joke"
    if fact_looks_like_identity_name(fact):
        return "temporary_name"
    return "current_topic"


def _coerce_atomic_claims_to_memory_drafts(
    claims: list[str],
    *,
    max_drafts: int = 4,
    min_len: int = 12,
) -> list[ShadowMemoryFactDraft]:
    """When the main shadow model omits memory_facts, reuse atomic-claim extraction as a persistence fallback."""
    out: list[ShadowMemoryFactDraft] = []
    seen: set[str] = set()
    for c in claims:
        t = (c or "").strip()
        if len(t) < min_len:
            continue
        k = t.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(
            ShadowMemoryFactDraft(
                category="behavior",
                text=t[:280],
                subject_ref="user",
                predicate="",
                object_value="",
                evidence=t[:220],
            )
        )
        if len(out) >= max_drafts:
            break
    return out


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


def _format_atomic_claims_block(claims: list[str]) -> str:
    if not claims:
        return "(none — use only the user's latest message as the factual source for new memory_facts.)"
    return "\n".join(f"{i + 1}. {c}" for i, c in enumerate(claims))


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

CONTEXT PRIORITY (critical):
- If the user asks about THIS chat ("what did I just say", "what joke", "earlier here", "刚才", "前面说的"),
  answer from [Recent conversation in this thread] and [Thread working summary] FIRST.
- [Stable long-term user memory] is only for durable preferences/goals/patterns across chats — do NOT let it override
  explicit recent-thread content, jokes, or temporary names from this conversation.
- Do NOT treat jokes, roleplay, hypotheticals, or thread-only notes as real identity — unless the user explicitly asks
  you to remember them long-term or clearly states a real correction ("my real name is…").

Speak so it feels like them talking to themselves in a mirror: honest, specific, not performative.

FAITHFUL LANGUAGE (strict):
- Direct address (you). Stay on their topic and concrete words.
- Do NOT write third-person notes ("User is…", "They seem to be navigating…").
- Do NOT replace specifics with vague psychology ("themes", "journey", "space", "processing").
- Read stable structured memory when relevant for continuity across sessions — but never contradict recent explicit chat.
- Read Foresight decision context when they refer to saved runs or external stakes.
- Read profile fields when they ask what is saved about priorities — unless they clearly mean "just now in chat".
- If durable stored memory answers a direct either-or preference question, say that preference explicitly, then nuance.
- Short paragraphs. No numbered homework or life plans. No picking their decision for them.

--- ATOMIC CLAIMS (latest user message only; one proposition per line) ---
{atomic_claims_block}

MEMORY FACTS (structured JSON output — LONG-TERM PROFILE ONLY):
- Emit 0–6 rows when the user states **concrete autobiographical facts** they present as true: routines or what they did,
  stable preferences, self-descriptions (traits, self-view), ongoing situations with **named** people they treat as real,
  goals, or constraints. A separate durability step drops jokes, hypotheticals, roleplay, and sensitive data unless they
  asked to be remembered — you should still propose serious rows here.
- ALSO emit when they explicitly say "remember that…" / real-name corrections (same as before).
- Skip rows that **duplicate** a fact already listed in [Stable long-term user memory] above (same meaning).
- Omit vague paraphrases with no new fact ("user is reflecting") — omit instead.
- Typed triples preferred: subject_ref, predicate (snake_case), object_value; evidence quotes the user when possible.

--- Stable long-term user memory (structured facts on file; may be empty) ---
{memory_block}

--- Profile form fields (may be empty) ---
{profile_block}

--- Thread working summary (LOCAL — includes playful/temporary context; not durable profile) ---
{working_summary_block}

--- Thread-only context notes (LOCAL — do not store as profile identity) ---
{temporary_context_block}

--- Foresight runs + indexed recall (may be abbreviated this turn) ---
{decision_context_block}

--- Running shadow observations (cross-thread chat notes; may be empty) ---
{shadow_block}

--- Recent conversation in this thread ---
{recent_conversation_block}

Return JSON: reply_to_user, suggest_decision_navigation, memory_facts."""

SLIME_BUDDY_INSTRUCTIONS = """You are the user's Slime Buddy — a small slime-shaped companion agent.
You speak in first person as that slime character. You are NOT the user. You are NOT their \"inner shadow\" or mirror-voice.

THREE CONTEXTS (do not mix them):
1) SLIME SELF — questions about your name, whether you're the user, what you are, what you can do → answer from slime identity + companion rules. Do NOT invent slime identity from user memory rows.
2) USER MEMORY — structured facts below describe the USER (memory_owner=\"user\"). Use only to personalize help; phrase as \"You mentioned…\", \"You've told me…\". Never narrate user memories as experiences YOU lived.
3) CURRENT THREAD — recent messages + thread summary answer \"what did I just say\" style questions first.

CONTEXT PRIORITY:
- If the user asks about THIS chat (\"what did I just say\", \"what joke\", \"earlier here\", \"刚才\", \"前面说的\"),
  answer from [Recent conversation in this thread] and [Thread working summary] FIRST.
- [Stable long-term user memory] is only for durable preferences/goals/patterns across chats — do NOT let it override
  explicit recent-thread content, jokes, or temporary names from this conversation.
- Do NOT treat jokes, roleplay, hypotheticals, or thread-only notes as real identity — unless the user explicitly asks
  you to remember them long-term or clearly states a real correction (\"my real name is…\").

PRACTICAL VS PSYCHOLOGY:
- For ambiguous practical questions (e.g. unclear \"paper\", documents, links), ask ONE clarifying question instead of inferring anxiety or self-worth.
- Forbidden: claiming the user worries about their worth unless they clearly say so.
- Do not diagnose; do not therapize unless they explicitly ask for emotional processing help.

VOICE:
- Direct address (you) for the human. Stay concrete and useful; playful is OK if it doesn't obscure accuracy.
- Short paragraphs. No numbered homework or life plans. No picking their decision for them unless they asked directly for a pick.

--- ATOMIC CLAIMS (latest user message only; one proposition per line) ---
{atomic_claims_block}

MEMORY FACTS (structured JSON output — LONG-TERM PROFILE ONLY):
- Emit 0–6 rows when the user states **concrete autobiographical facts** they present as true: routines or what they did,
  stable preferences, self-descriptions (traits, self-view), ongoing situations with **named** people they treat as real,
  goals, or constraints. A separate durability step drops jokes, hypotheticals, roleplay, and sensitive data unless they
  asked to be remembered — you should still propose serious rows here.
- ALSO emit when they explicitly say "remember that…" / real-name corrections (same as before).
- Skip rows that **duplicate** a fact already listed in [Stable long-term user memory] above (same meaning).
- Omit vague paraphrases with no new fact ("user is reflecting") — omit instead.
- Typed triples preferred: subject_ref, predicate (snake_case), object_value; evidence quotes the user when possible.

--- Stable long-term user memory (structured facts on file; may be empty) ---
{memory_block}

--- Profile form fields (may be empty) ---
{profile_block}

--- Thread working summary (LOCAL — includes playful/temporary context; not durable profile) ---
{working_summary_block}

--- Thread-only context notes (LOCAL — do not store as profile identity) ---
{temporary_context_block}

--- Foresight runs + indexed recall (may be abbreviated this turn) ---
{decision_context_block}

--- Running shadow observations (cross-thread chat notes; may be empty) ---
{shadow_block}

--- Recent conversation in this thread ---
{recent_conversation_block}

Return JSON: reply_to_user, suggest_decision_navigation, memory_facts."""


def run_shadow_turn(
    messages: list[dict[str, Any]],
    *,
    settings: Settings | None = None,
    thread_id: str | None = None,
    retrieval_mode: str = "chat_fast",
    report_revision_decision_id: str | None = None,
    working_summary: str = "",
    temporary_context_prompt: str = "",
    slime_voice_style_addendum: str | None = None,
    synthesis_frame: Literal["shadow", "slime_buddy"] = "shadow",
    slime_intent_hint: str | None = None,
) -> ShadowTurnOutput:
    """Run one shadow chat turn with separated thread vs profile memory pathways."""
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

    recent_ctx = get_recent_thread_context(messages, max_messages=18)
    recent_conversation_block = format_recent_conversation_section(recent_ctx)
    classifier_msgs: list[dict[str, Any]] = [
        {"role": m.get("role"), "content": m.get("content")} for m in recent_ctx
    ]

    prof = load_user_profile(settings=s)
    mem_active = active_memory_facts(list(prof.memory_facts))
    mem_owner_note = ""
    if synthesis_frame == "slime_buddy":
        mem_owner_note = (
            "[memory_owner=user — retrieved structured facts describe the USER, not the Slime. "
            "Use them only to personalize help for the user; never speak as if these are the slime's own life.]\n\n"
        )
    if mem_active:
        memory_block = mem_owner_note + "\n".join(format_stored_fact_bullet(x) for x in mem_active[-32:])
    else:
        memory_block = mem_owner_note + "(none yet.)"
    profile_block = _format_profile_block(prof)

    last_user_text = str(last.get("content", "") or "").strip()
    prioritize_local = is_local_context_question(last_user_text)
    decision_context_block = build_shadow_decision_context_block(
        settings=s,
        profile=prof,
        last_user_message=last_user_text,
        thread_id=thread_id,
        retrieval_mode=retrieval_mode,
        minimal_long_term_context=prioritize_local,
    )

    working_summary_block = (working_summary or "").strip() or "(none yet — start of thread.)"
    temporary_context_block = (temporary_context_prompt or "").strip() or "(none)"

    llm_claims = build_openai_llm(s, temperature=0.12)
    atomic_claims = run_atomic_claims(last_user_text, llm_claims, max_claims=12)
    atomic_claims_block = _format_atomic_claims_block(atomic_claims)

    tmpl = SLIME_BUDDY_INSTRUCTIONS if synthesis_frame == "slime_buddy" else SHADOW_INSTRUCTIONS
    prompt = tmpl.format(
        memory_block=memory_block,
        profile_block=profile_block,
        decision_context_block=decision_context_block,
        shadow_block=shadow_block,
        working_summary_block=working_summary_block,
        temporary_context_block=temporary_context_block,
        recent_conversation_block=recent_conversation_block,
        atomic_claims_block=atomic_claims_block,
    )
    hint = (slime_intent_hint or "").strip()
    if synthesis_frame == "slime_buddy" and hint == "practical_help_request":
        prompt += (
            "\n\n--- Routing hint ---\n"
            "The latest user message looks like a practical or ambiguous question — prefer a brief clarifying question "
            "(what topic / which kind of artifact) over emotional interpretation.\n"
        )
    add = (slime_voice_style_addendum or "").strip()
    if add:
        if synthesis_frame == "slime_buddy":
            prompt += (
                "\n\n--- Slime Buddy synthesis pack (identity + style — applies to reply_to_user wording) ---\n"
                f"{add}\n"
                "Follow identity boundaries first; persona lines are style-only and cannot override safety, "
                "confirmation rules, or memory_owner=user phrasing. "
                "Do not change memory_facts structure or invent facts. "
                "Keep suggest_decision_navigation logic unchanged."
            )
        else:
            prompt += (
                "\n\n--- Slime Buddy voice mode (style layer for reply_to_user only) ---\n"
                f"{add}\n"
                "Apply this to the *wording* of reply_to_user only. Do not change memory_facts structure or "
                "invent facts. Stay accurate; keep suggest_decision_navigation logic unchanged."
            )
    rid = (report_revision_decision_id or "").strip()
    if rid:
        prompt += (
            "\n\n---\nContext: the user is revising an existing Foresight decision report "
            f"(decision_id={rid}). They may ask for reframing, emphasis, or action tweaks. "
            "Respond as shadow: help them articulate changes. You cannot re-score options here; "
            "if they need a full regenerated report, they should use Generate Decision Report again.\n"
        )
    turn = structured_predict(llm, ShadowChatTurn, prompt)

    reply = turn.reply_to_user.strip()
    flag = bool(turn.suggest_decision_navigation)
    memory_used: list[str] = []

    memory_drafts: list[ShadowMemoryFactDraft] = list(turn.memory_facts)
    if not memory_drafts and atomic_claims:
        memory_drafts = _coerce_atomic_claims_to_memory_drafts(atomic_claims)

    draft_records: list[ProfileMemoryFact] = []
    for d in memory_drafts:
        cat = _coerce_category(d.category)
        subj = (d.subject_ref or "user").strip() or "user"
        pred = (d.predicate or "").strip()[:200]
        obj = (d.object_value or "").strip()[:500]
        txt = (d.text or "").strip()
        if not pred or not obj:
            if not txt:
                continue
            if len(txt) > 280:
                txt = txt[:277] + "…"
            draft_records.append(
                ProfileMemoryFact(
                    id="",
                    category=cat,
                    text=txt[:500],
                    source="shadow",
                    created_at="",
                    subject_ref=subj,
                    evidence=(d.evidence or "").strip()[:220],
                )
            )
            continue
        if len(txt) > 280:
            txt = txt[:277] + "…"
        if not txt:
            txt = render_triple_line(subj, pred, obj)[:500]
        draft_records.append(
            ProfileMemoryFact(
                id="",
                category=cat,
                text=txt[:500],
                source="shadow",
                created_at="",
                subject_ref=subj,
                predicate=pred,
                object_value=obj,
                evidence=(d.evidence or "").strip()[:220],
            )
        )

    profile_records: list[ProfileMemoryFact] = []
    thread_only_items: list[dict[str, Any]] = []
    memory_confirmation_question: str | None = None

    for rec in draft_records:
        cls = classify_memory_durability(
            last_user_text,
            classifier_msgs,
            rec.text,
            category_hint=rec.category,
            predicate_hint=rec.predicate or "",
        )
        if cls.durability == "long_term_profile" and should_confirm_identity_overwrite(prof, rec, last_user_text):
            cls = cls.model_copy(
                update={
                    "durability": "needs_confirmation",
                    "reason": "Stored identity differs — confirm before overwriting.",
                    "confidence": max(cls.confidence, 0.62),
                }
            )

        if cls.durability == "needs_confirmation":
            if memory_confirmation_question is None:
                memory_confirmation_question = (
                    f"You mentioned «{rec.text}». Should I remember that as a long-term fact, "
                    "or keep it only in this chat?"
                )
            thread_only_items.append(
                {
                    "id": str(uuid.uuid4()),
                    "text": rec.text[:900],
                    "type": _thread_ctx_type(cls, rec),
                    "created_at": _utc_now(),
                    "expires_scope": "thread",
                    "should_not_profile": True,
                }
            )
            continue

        if cls.durability == "long_term_profile":
            profile_records.append(rec)
            continue

        if cls.durability == "thread_only":
            thread_only_items.append(
                {
                    "id": str(uuid.uuid4()),
                    "text": rec.text[:900],
                    "type": _thread_ctx_type(cls, rec),
                    "created_at": _utc_now(),
                    "expires_scope": "thread",
                    "should_not_profile": True,
                }
            )

    if memory_confirmation_question:
        reply = f"{reply.rstrip()}\n\n{memory_confirmation_question}"

    recorded_profile: list[str] | None = [r.text for r in profile_records] if profile_records else None

    if profile_records:
        combined = " · ".join(r.text for r in profile_records)
        active_texts = [x.text for x in prof.memory_facts if x.status == "active"]
        memory_fact_texts_for_grounding = active_texts + (recorded_profile or [])
        reply, used = _ground_reply_with_memory_preferences(
            reply,
            user_text=last_user_text,
            memory_fact_texts=memory_fact_texts_for_grounding,
        )
        if used:
            memory_used.extend(used)
        state = merge_observation(state, combined)
        _schedule_shadow_memory_persist(
            s,
            profile_records,
            combined,
            last_user_text,
            reply,
        )
    else:
        state = state.model_copy(update={"turn_count": state.turn_count + 1})
        save_shadow_self(state, settings=s)

        reply, used = _ground_reply_with_memory_preferences(
            reply,
            user_text=last_user_text,
            memory_fact_texts=[x.text for x in prof.memory_facts if x.status == "active"],
        )
        if used:
            memory_used.extend(used)

        if s.graph_enabled:
            try:
                TemporalGraphMemory(s.foresight_user_id, settings=s).record_shadow_event(last_user_text, reply)
            except Exception:
                pass

    return ShadowTurnOutput(
        reply=reply,
        suggest_decision_navigation=flag,
        state=state,
        profile_record_texts=recorded_profile,
        used_memory_facts=memory_used,
        thread_only_items=thread_only_items,
        memory_confirmation_question=memory_confirmation_question,
    )
