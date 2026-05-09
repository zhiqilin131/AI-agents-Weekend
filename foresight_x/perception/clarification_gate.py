"""Deterministic clarification gate (<50ms). No LLM. Used before smart/async clarification."""

from __future__ import annotations

import re
import time
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.perception.clarify_types import ClarifyOption, ClarifyQuestion
from foresight_x.perception.personalized_clarify import (
    _message_clear_enough_to_skip,
    heuristic_domain,
    should_skip_clarification_for_shadow_chat,
)


def default_clarification_state() -> dict[str, Any]:
    return {
        "last_question": "",
        "last_target_dimension": "",
        "last_asked_at": "",
        "skipped_dimensions": [],
        "answered_dimensions": [],
        "pending_request_id": "",
        "suppress_clarify_until_user_count": 0,
    }


def _slug_dim(name: str) -> str:
    s = re.sub(r"[^\w]+", "_", (name or "").lower()).strip("_")
    return s[:80] or "dimension"


def _user_message_count(thread_metadata: dict[str, Any]) -> int:
    return sum(1 for m in thread_metadata.get("messages") or [] if str(m.get("role") or "") == "user")


def is_empty_or_new_thread(user_message: str) -> bool:
    return not (user_message or "").strip()


def recently_skipped_suppression(thread_metadata: dict[str, Any]) -> bool:
    st = thread_metadata.get("clarification_state") or {}
    threshold = int(st.get("suppress_clarify_until_user_count") or 0)
    if threshold <= 0:
        return False
    cur = _user_message_count(thread_metadata)
    return cur < threshold


def recently_asked_similar_clarification(
    thread_clarification_events: list[dict[str, Any]],
    target_dimension: str,
    *,
    last_n: int = 14,
) -> bool:
    want = _slug_dim(target_dimension)
    if not want:
        return False
    answered_dims = set()
    for ev in thread_clarification_events[-last_n:]:
        k = str(ev.get("kind") or "")
        d = _slug_dim(str(ev.get("target_dimension") or ""))
        if k == "answered" and d:
            answered_dims.add(d)
        if k != "asked":
            continue
        if d == want:
            return True
    if want in answered_dims:
        return True
    return False


def dimension_in_thread_state(
    thread_metadata: dict[str, Any],
    target_dimension: str,
) -> bool:
    st = thread_metadata.get("clarification_state") or {}
    sd = {_slug_dim(str(x)) for x in (st.get("skipped_dimensions") or [])}
    ad = {_slug_dim(str(x)) for x in (st.get("answered_dimensions") or [])}
    want = _slug_dim(target_dimension)
    return want in sd or want in ad


_VAGUE_HELP_EN = re.compile(
    r"\b(help me decide|not sure what to do|don'?t know what to do|i need help deciding|"
    r"i need guidance|what should i do|stuck between|can you help me think)\b",
    re.I,
)
_VAGUE_HELP_ZH = re.compile(r"(我不知道该怎么办|帮我决定|帮我分析|不知道怎么选|很纠结|拿不定主意)")
_GREETING_ONLY = re.compile(r"^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))[\s,.!?]*$", re.I)
_FACTUAL_LEAD = re.compile(
    r"^\s*(what is|what are|who is|when did|where is|how does|how do you|explain |define |"
    r"translate |calculate )\b",
    re.I,
)
_FORK_OR = re.compile(r"\sor\s", re.I)
_DECISIONISH_SOFT = re.compile(r"\b(should i|ought i|would it be worth|is it worth)\b", re.I)


class ClarificationFastResult(BaseModel):
    should_ask: bool = False
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    reason: str = ""
    domain: str = "other"
    fast_question: str | None = None
    requires_llm: bool = False
    target_dimension: str | None = None
    fast_option_labels: list[tuple[str, str]] = Field(
        default_factory=list,
        description="(value, label) pairs for multiple-choice fast path",
    )


def build_timeout_fallback_questions(domain: str) -> list[ClarifyQuestion]:
    """Deterministic question list when smart clarification times out."""
    tid, q, opts = _fast_pack(domain)
    fr = ClarificationFastResult(
        should_ask=True,
        confidence=0.45,
        reason="llm_timeout_fallback",
        domain=domain,
        fast_question=q,
        requires_llm=False,
        target_dimension=tid,
        fast_option_labels=opts,
    )
    return build_fast_clarify_questions(fr)


def build_fast_clarify_questions(fast: ClarificationFastResult) -> list[ClarifyQuestion]:
    if not fast.should_ask or not fast.fast_question:
        return []
    dim = fast.target_dimension or "clarify_focus"
    opts = [
        ClarifyOption(value=v, label=lb)
        for v, lb in fast.fast_option_labels
        if lb.strip()
    ]
    if len(opts) < 2:
        opts = [
            ClarifyOption(value="need_more_detail", label="Walk me through it in chat"),
            ClarifyOption(value="prefer_skip", label="Skip — context is enough"),
        ]
    return [ClarifyQuestion(id=_slug_dim(dim), prompt=fast.fast_question.strip(), options=opts[:6])]


def _opts_generic_decision() -> list[tuple[str, str]]:
    return [
        ("options_unclear", "I'm still mapping the options"),
        ("two_options", "Two concrete options"),
        ("many_tradeoffs", "Several options / messy tradeoffs"),
    ]


def _opts_career() -> list[tuple[str, str]]:
    return [
        ("learning", "Learning / skills"),
        ("prestige", "Prestige / signal"),
        ("pay", "Pay"),
        ("workload", "Workload / stress"),
        ("location", "Location / commute"),
    ]


def _opts_academic() -> list[tuple[str, str]]:
    return [
        ("grades", "Grades"),
        ("workload", "Workload"),
        ("learning", "Learning depth"),
        ("grad_progress", "Graduation progress"),
    ]


def _opts_project() -> list[tuple[str, str]]:
    return [
        ("technical_depth", "Technical depth"),
        ("product_clarity", "Product clarity"),
        ("demo_impact", "Demo impact"),
    ]


def _opts_relationship() -> list[tuple[str, str]]:
    return [
        ("understand", "Understand the situation"),
        ("decide_action", "Decide what to do"),
        ("prepare_words", "Prepare what to say"),
    ]


def _opts_social() -> list[tuple[str, str]]:
    return [
        ("specific_incident", "A specific incident"),
        ("broader_context", "Broader context"),
        ("express_view", "How to express my view"),
    ]


def _opts_scheduling() -> list[tuple[str, str]]:
    return [
        ("hard_constraints", "Hard time constraints"),
        ("energy", "Energy / focus pattern"),
        ("deadlinePressure", "Deadline pressure"),
        ("flexibility", "Flexibility vs structure"),
    ]


def _fast_pack(domain: str) -> tuple[str, str, list[tuple[str, str]]]:
    """target_dimension, question, options."""
    dom = (domain or "other").lower()
    if dom == "career":
        return (
            "career_primary_axis",
            "What matters most here: learning, prestige, pay, workload, or location?",
            _opts_career(),
        )
    if dom == "academic":
        return (
            "academic_primary_concern",
            "Is your main concern grades, workload, learning depth, or graduation progress?",
            _opts_academic(),
        )
    if dom == "project":
        return (
            "project_success_metric",
            "Are you optimizing for technical depth, product clarity, or demo impact?",
            _opts_project(),
        )
    if dom == "relationship":
        return (
            "relationship_goal",
            "Are you trying to understand the situation, decide what to do, or prepare what to say?",
            _opts_relationship(),
        )
    if dom == "social_issue":
        return (
            "social_issue_framing",
            "Are you asking about a specific incident, broader context, or how to express your view?",
            _opts_social(),
        )
    if dom == "scheduling":
        return (
            "scheduling_crux",
            "What should we optimize first: hard constraints, energy pattern, deadlines, or flexibility?",
            _opts_scheduling(),
        )
    if dom == "finance":
        return (
            "finance_primary_axis",
            "What matters most: safety, growth, liquidity, or time horizon?",
            [
                ("safety", "Safety / capital preservation"),
                ("growth", "Growth"),
                ("liquidity", "Liquidity / cash flow"),
                ("horizon", "Time horizon"),
            ],
        )
    # generic decision / other
    return (
        "choice_between",
        "What are the options you're choosing between?",
        _opts_generic_decision(),
    )


def should_show_clarification_fast(
    user_message: str,
    recent_messages: list[dict[str, Any]],
    thread_metadata: dict[str, Any],
    profile_summary: str | None = None,
    *,
    interaction_purpose: str | None = None,
) -> ClarificationFastResult:
    """
    Pure heuristic gate — must stay fast (<50ms). Does not call LLM.
    profile_summary reserved for future ranking; ignored for now.
    """
    _ = profile_summary
    text = (user_message or "").strip()
    if not text:
        return ClarificationFastResult(
            should_ask=False,
            confidence=1.0,
            reason="empty_chat",
            domain="other",
        )
    purpose = (interaction_purpose or "").strip()
    if purpose == "shadow_chat" and should_skip_clarification_for_shadow_chat(text):
        return ClarificationFastResult(
            should_ask=False,
            confidence=0.9,
            reason="shadow_chat_non_analytical",
            domain="casual",
        )
    if len(text) < 80 and _GREETING_ONLY.match(text):
        return ClarificationFastResult(should_ask=False, confidence=0.85, reason="greeting_only", domain="casual")
    if _FACTUAL_LEAD.search(text[:72]) and len(text) < 200:
        return ClarificationFastResult(should_ask=False, confidence=0.72, reason="factual_question", domain="other")

    if recently_skipped_suppression(thread_metadata):
        return ClarificationFastResult(
            should_ask=False,
            confidence=0.8,
            reason="recently_skipped",
            domain="other",
        )

    if _message_clear_enough_to_skip(text):
        return ClarificationFastResult(
            should_ask=False,
            confidence=0.75,
            reason="enough_context",
            domain=heuristic_domain(text),
        )

    recent_for_intent = [
        {"role": str(m.get("role") or ""), "content": str(m.get("content") or "")}
        for m in (recent_messages or [])[-6:]
    ]
    from foresight_x.chat.intent_detector import detect_chat_intent

    intent = detect_chat_intent(text, recent_for_intent, llm_enabled=False)
    dom = heuristic_domain(text)

    # Heuristic intent often scores <0.66 for a lone "should i …" (no "or" fork); still decision-shaped.
    decisionish_soft = bool(_DECISIONISH_SOFT.search(text)) and len(text.strip()) >= 12
    counts_as_decision = intent.intent == "decision_candidate" or (
        dom == "social_issue" and decisionish_soft and len(text) > 18
    ) or decisionish_soft

    if not counts_as_decision and not _VAGUE_HELP_EN.search(text) and not _VAGUE_HELP_ZH.search(text):
        return ClarificationFastResult(
            should_ask=False,
            confidence=0.65,
            reason="not_decision_or_help_request",
            domain=dom,
        )

    if counts_as_decision and _FORK_OR.search(text) and len(text) >= 24:
        return ClarificationFastResult(
            should_ask=False,
            confidence=0.7,
            reason="enough_context",
            domain=dom,
        )

    # High-impact missing variable → domain template or LLM
    if _VAGUE_HELP_EN.search(text) or _VAGUE_HELP_ZH.search(text):
        tid, q, opts = _fast_pack("generic")
        if dimension_in_thread_state(thread_metadata, tid) or recently_asked_similar_clarification(
            list(thread_metadata.get("clarification_events") or []),
            tid,
        ):
            return ClarificationFastResult(
                should_ask=False,
                confidence=0.55,
                reason="already_clarified_dimension",
                domain=dom,
            )
        return ClarificationFastResult(
            should_ask=True,
            confidence=0.82,
            reason="vague_help_request",
            domain="generic_decision",
            fast_question=q,
            requires_llm=False,
            target_dimension=tid,
            fast_option_labels=opts,
        )

    # Decision-shaped but needs richer tailoring → LLM unless domain-specific template fits
    smart_domains = (
        "career",
        "academic",
        "relationship",
        "social_issue",
        "project",
        "scheduling",
        "finance",
    )
    if dom in smart_domains:
        tid, q, opts = _fast_pack(dom)
        if dimension_in_thread_state(thread_metadata, tid) or recently_asked_similar_clarification(
            list(thread_metadata.get("clarification_events") or []),
            tid,
        ):
            return ClarificationFastResult(
                should_ask=False,
                confidence=0.58,
                reason="already_clarified_dimension",
                domain=dom,
            )
        return ClarificationFastResult(
            should_ask=True,
            confidence=0.74,
            reason=f"decision_candidate_domain:{dom}",
            domain=dom,
            fast_question=q,
            requires_llm=False,
            target_dimension=tid,
            fast_option_labels=opts,
        )

    return ClarificationFastResult(
        should_ask=True,
        confidence=0.62,
        reason="decision_candidate_needs_smart_clarify",
        domain=dom,
        requires_llm=True,
    )


def fast_gate_timing_ms(start_perf: float) -> float:
    return round((time.perf_counter() - start_perf) * 1000.0, 3)
