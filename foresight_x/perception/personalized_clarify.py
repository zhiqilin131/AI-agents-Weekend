"""Personalized clarification: domain-aware, memory-aware, scored candidates (VoI-style)."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from foresight_x.profile.memory_structured import (
    active_memory_facts,
    format_memory_fact_prompt_line,
    user_scope_memory_facts,
)
from foresight_x.config import Settings
from foresight_x.profile.merge import append_clarification_to_profile, append_profile_memory_records
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.schemas import MemoryFactCategory, ProfileMemoryFact, UserProfile
from foresight_x.structured_predict import structured_predict

from foresight_x.perception.clarify_types import (
    ClarifyGateResult,
    ClarifyOption,
    ClarifyQuestion,
    StructuredPredictLLM,
)

# --- Lightweight context bundle -------------------------------------------------

DOMAIN_KEYWORDS: dict[str, tuple[str, ...]] = {
    "career": ("job", "career", "intern", "offer", "salary", "promotion", "work", "company", "interview"),
    "academic": ("class", "grade", "school", "professor", "exam", "gpa", "major", "course", "study", "transfer"),
    "relationship": (
        "partner",
        "friend",
        "family",
        "breakup",
        "dating",
        "marriage",
        "boundary",
        "trust",
        "roommate",
        "roommates",
    ),
    "social_issue": ("race", "racism", "discrimination", "policy", "justice", "inequality", "society", "politics"),
    "project": ("demo", "project", "ship", "mvp", "prototype", "codebase", "deadline", "feature"),
    "finance": ("invest", "loan", "debt", "savings", "budget", "401k", "stock", "mortgage", "rent"),
    "scheduling": ("calendar", "schedule", "meeting", "block", "time slot", "availability", "planner"),
    "writing": ("essay", "draft", "tone", "edit", "blog", "paper", "thesis"),
    "technical_debugging": ("error", "stack trace", "bug", "compile", "exception", "debug", "api"),
    "decision": ("should i", "which option", "choose between", "vs ", "versus", "decide"),
    "casual": ("hi", "hello", "thanks", "lol", "how are you"),
}

UNKNOWN_DIMENSIONS_BY_DOMAIN: dict[str, str] = {
    "career": (
        "prestige_vs_learning, risk_tolerance, workload_limit, compensation vs growth, "
        "location, long_term_goal, mentorship"
    ),
    "academic": (
        "grade_sensitivity, workload_tolerance, learning_goal, schedule_constraint, "
        "project_vs_exam_preference"
    ),
    "relationship": (
        "desired_outcome, communication_style, boundary_preference, conflict_tolerance, emotional_priority"
    ),
    "social_issue": (
        "analysis_goal, personal_event_context, desired_framing, tone_preference, audience — "
        "never stereotypes about protected groups"
    ),
    "project": (
        "success_metric, user_target, demo_priority, technical_risk, time_budget, aesthetic_preference"
    ),
    "finance": "risk_tolerance, time_horizon, liquidity_needs, goals, constraints",
    "scheduling": "hard_constraints, energy_pattern, deep_work_preference, deadline, flexibility",
    "writing": "audience, goal, tone, length, deadline",
    "technical_debugging": "environment, repro steps, constraints, success_criteria",
    "decision": "tradeoffs, stakes, reversibility, values at play",
    "casual": "(usually none — prefer should_ask=false)",
    "other": "goals, constraints, tradeoffs that matter for this specific message",
}


def heuristic_domain(user_message: str) -> str:
    t = user_message.lower()
    scores: dict[str, int] = {k: 0 for k in DOMAIN_KEYWORDS}
    for dom, keys in DOMAIN_KEYWORDS.items():
        scores[dom] = sum(1 for k in keys if k in t)
    best = max(scores, key=lambda d: scores[d])
    if scores[best] <= 0:
        return "other"
    return best


def _token_set(text: str) -> set[str]:
    return {x for x in re.split(r"[^\w]+", text.lower()) if len(x) > 2}


def filter_memory_for_clarify(
    user_message: str,
    domain: str,
    profile: UserProfile,
    *,
    max_lines: int = 14,
) -> list[str]:
    """Select a small set of memory lines relevant to the message + domain (not full dump)."""
    um = _token_set(user_message)
    dom_keys = set(DOMAIN_KEYWORDS.get(domain, ()))
    facts = user_scope_memory_facts(active_memory_facts(list(profile.memory_facts)))
    scored: list[tuple[float, str]] = []
    for f in facts:
        line = format_memory_fact_prompt_line(f)
        ft = _token_set(line)
        overlap = len(um & ft)
        dom_boost = sum(1 for k in dom_keys if k in line.lower())
        s = overlap * 1.4 + dom_boost * 0.35
        if s > 0.01:
            scored.append((s, line))
    scored.sort(key=lambda x: -x[0])
    out = [x[1] for x in scored[:max_lines]]
    if len(out) < max_lines:
        for t in profile.profile_channel_priority_texts()[:6]:
            if t and t not in out:
                out.append(f"(priority) {t}")
            if len(out) >= max_lines:
                break
    return out[:max_lines]


@dataclass
class ClarificationContext:
    """Structured inputs for the clarification LLM (query enhancement)."""

    user_message: str
    recent_transcript: str
    profile_fact_lines: list[str] = field(default_factory=list)
    saved_clarification_lines: list[str] = field(default_factory=list)
    thread_clarification_summary: str = ""
    domain_hint: str = "other"
    heuristic_domain: str = "other"

    def to_prompt_block(self) -> str:
        lines = [
            f"Heuristic domain guess: {self.heuristic_domain}",
            f"Domain hint (may refine): {self.domain_hint}",
            "",
            "=== User message ===",
            self.user_message.strip(),
            "",
            "=== Recent conversation (last turns) ===",
            self.recent_transcript.strip() or "(none)",
            "",
            "=== Relevant profile / memory lines (subset; do not assume unstated facts) ===",
            "\n".join(f"- {x}" for x in self.profile_fact_lines) if self.profile_fact_lines else "(none)",
            "",
            "=== Prior saved clarification answers (profile channel) ===",
            "\n".join(f"- {x}" for x in self.saved_clarification_lines) if self.saved_clarification_lines else "(none)",
            "",
            "=== Clarification events in this thread (asked / answered / skipped) ===",
            self.thread_clarification_summary.strip() or "(none)",
        ]
        return "\n".join(lines)


def build_clarification_context(
    user_message: str,
    recent_messages: list[dict[str, str]],
    user_profile: UserProfile,
    *,
    retrieved_memory_lines: list[str] | None = None,
    thread_clarification_events: list[dict[str, Any]] | None = None,
) -> ClarificationContext:
    dom = heuristic_domain(user_message)
    mem_lines = retrieved_memory_lines
    if mem_lines is None:
        mem_lines = filter_memory_for_clarify(user_message, dom, user_profile)
    transcript_lines: list[str] = []
    for m in recent_messages[-10:]:
        role = str(m.get("role") or "").strip()
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        transcript_lines.append(f"{role}: {content}")
    ev_summary = ""
    if thread_clarification_events:
        bits = []
        for ev in thread_clarification_events[-8:]:
            bits.append(
                f"- {ev.get('kind')} dim={ev.get('target_dimension')} "
                f"q={str(ev.get('question_prompt') or '')[:80]!r} "
                f"a={str(ev.get('answer_label') or '')[:80]!r}"
            )
        ev_summary = "\n".join(bits)
    return ClarificationContext(
        user_message=user_message.strip(),
        recent_transcript="\n".join(transcript_lines),
        profile_fact_lines=list(mem_lines),
        saved_clarification_lines=list(user_profile.clarification_priority_texts())[-12:],
        thread_clarification_summary=ev_summary,
        domain_hint=dom,
        heuristic_domain=dom,
    )


# --- LLM output models ----------------------------------------------------------

class MissingDimensionSpec(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    importance: float = Field(ge=0.0, le=1.0, default=0.5)
    confidence: float = Field(ge=0.0, le=1.0, default=0.3)
    reason: str = Field(default="", max_length=400)


class PersonalizedCandidate(BaseModel):
    question: str = Field(min_length=4, max_length=500)
    target_dimension: str = Field(min_length=1, max_length=120)
    options: list[ClarifyOption] = Field(min_length=2, max_length=5)
    domain_relevance: float = Field(ge=0.0, le=1.0)
    uncertainty_reduction: float = Field(ge=0.0, le=1.0)
    decision_impact: float = Field(ge=0.0, le=1.0)
    personalization_value: float = Field(ge=0.0, le=1.0)
    user_friction: float = Field(ge=0.0, le=1.0)
    sensitivity_risk: float = Field(ge=0.0, le=1.0)
    why_this_question: str = Field(default="", max_length=400)


class PersonalizedClarifyLLMOutput(BaseModel):
    domain: str = Field(
        description=(
            "One of: decision, career, academic, relationship, social_issue, project, finance, "
            "scheduling, writing, technical_debugging, casual, other"
        )
    )
    user_intent: str = Field(default="", max_length=600)
    known_about_user: list[str] = Field(default_factory=list, max_length=24)
    missing_dimensions: list[MissingDimensionSpec] = Field(default_factory=list, max_length=12)
    candidate_questions: list[PersonalizedCandidate] = Field(min_length=1, max_length=6)
    selected_question: str = Field(default="", max_length=500)
    should_ask: bool = False


# --- Deterministic scoring ------------------------------------------------------

_GENERIC_BUDGET = re.compile(
    r"\b(budget|how much (money )?can you spend|financial resources|affordability|afford to)\b",
    re.I,
)
_GENERIC_URGENCY = re.compile(r"\b(how urgent|urgency|asap|right away|immediately)\b", re.I)
_GENERIC_DEADLINE = re.compile(r"\b(what.?s your deadline|hard deadline|time constraint)\b", re.I)
_STEREOTYPE_RISK = re.compile(
    r"\b(what (do you think|are)|how (do|are)|describe|generalize about)\b.+\b("
    r"black people|white people|asian people|women|men|muslims?|jews?|lgbt|gay people|trans people|immigrants?)\b",
    re.I | re.DOTALL,
)
_PROTECTED_JUDGMENT = re.compile(
    r"\b(all|most|every) (black|white|asian|latino|hispanic|muslim|jewish|gay|trans|women|men)\b",
    re.I,
)


def _slug_dim(name: str) -> str:
    s = re.sub(r"[^\w]+", "_", (name or "").lower()).strip("_")
    return s[:80] or "dimension"


def heuristic_sensitivity_risk(question: str) -> float:
    q = question.strip()
    if not q:
        return 0.0
    risk = 0.0
    if _STEREOTYPE_RISK.search(q):
        risk = max(risk, 0.95)
    if _PROTECTED_JUDGMENT.search(q):
        risk = max(risk, 0.9)
    return min(1.0, risk)


def generic_checklist_penalty(question: str, domain: str) -> float:
    """Penalty 0..1 for off-domain generic budget/urgency/deadline checklist."""
    pen = 0.0
    d = (domain or "").lower()
    if _GENERIC_BUDGET.search(question) and d not in ("finance", "project", "scheduling"):
        pen += 0.85
    if _GENERIC_URGENCY.search(question) and d not in ("scheduling", "project", "finance", "decision"):
        pen += 0.55
    if _GENERIC_DEADLINE.search(question) and d not in ("scheduling", "project", "academic"):
        pen += 0.45
    return min(1.0, pen)


def repetition_penalty(
    candidate: PersonalizedCandidate,
    *,
    thread_events: list[dict[str, Any]],
    profile_blob: str,
) -> float:
    """Penalty when dimension or wording was recently used."""
    pen = 0.0
    dim = _slug_dim(candidate.target_dimension)
    recent_dims: set[str] = set()
    recent_q: list[str] = []
    for ev in thread_events[-12:]:
        d = str(ev.get("target_dimension") or "").strip().lower()
        if d:
            recent_dims.add(_slug_dim(d))
        qp = str(ev.get("question_prompt") or "").strip().lower()
        if qp:
            recent_q.append(qp)
    if dim in recent_dims:
        pen += 0.95
    cq = candidate.question.strip().lower()
    for prev in recent_q[-4:]:
        if prev and (prev in cq or cq in prev):
            pen += 0.75
    dim_words = re.sub(r"_+", " ", dim).split()
    pb = profile_blob.lower()
    if dim_words and all(w in pb for w in dim_words if len(w) > 3):
        pen += 0.35
    if _GENERIC_BUDGET.search(candidate.question) or _GENERIC_URGENCY.search(candidate.question):
        for ev in thread_events[-6:]:
            prev_q = str(ev.get("question_prompt") or "")
            if _GENERIC_BUDGET.search(prev_q) or _GENERIC_URGENCY.search(prev_q):
                pen += 0.5
                break
    return min(1.5, pen)


def final_candidate_score(
    candidate: PersonalizedCandidate,
    *,
    domain: str,
    thread_events: list[dict[str, Any]],
    profile_blob: str,
) -> float:
    h_risk = heuristic_sensitivity_risk(candidate.question)
    sens = max(float(candidate.sensitivity_risk), h_risk)
    gen_pen = generic_checklist_penalty(candidate.question, domain)
    rep_pen = repetition_penalty(candidate, thread_events=thread_events, profile_blob=profile_blob)
    return (
        1.2 * float(candidate.domain_relevance)
        + 1.2 * float(candidate.uncertainty_reduction)
        + 1.0 * float(candidate.decision_impact)
        + 0.8 * float(candidate.personalization_value)
        - 0.8 * float(candidate.user_friction)
        - 1.0 * rep_pen
        - 1.2 * sens
        - 1.0 * gen_pen
    )


def _pick_candidates_ranked(
    llm_out: PersonalizedClarifyLLMOutput,
    *,
    thread_events: list[dict[str, Any]],
    profile: UserProfile,
) -> list[tuple[float, PersonalizedCandidate]]:
    profile_blob = " ".join(
        profile.clarification_priority_texts()
        + [
            format_memory_fact_prompt_line(f)
            for f in user_scope_memory_facts(active_memory_facts(list(profile.memory_facts)))[:24]
        ]
        + profile.profile_channel_priority_texts()
    )
    domain = (llm_out.domain or "other").lower()
    ranked: list[tuple[float, PersonalizedCandidate]] = []
    for c in llm_out.candidate_questions:
        ranked.append(
            (
                final_candidate_score(c, domain=domain, thread_events=thread_events, profile_blob=profile_blob),
                c,
            )
        )
    ranked.sort(key=lambda x: -x[0])
    return ranked


def _match_selected_to_candidate(
    llm_out: PersonalizedClarifyLLMOutput,
    ranked: list[tuple[float, PersonalizedCandidate]],
) -> PersonalizedCandidate | None:
    sel = (llm_out.selected_question or "").strip().lower()
    if not ranked:
        return None
    for _, c in ranked:
        if c.question.strip().lower() == sel:
            return c
    for _, c in ranked:
        if sel and sel[:48] in c.question.strip().lower():
            return c
    return ranked[0][1]


def _message_clear_enough_to_skip(user_message: str) -> bool:
    t = user_message.strip()
    if len(t) >= 220:
        return True
    if re.search(r"\b(i want|i need|i prefer|because|tradeoff|versus|vs\.?)\b", t, re.I) and len(t) > 80:
        return True
    return False


_JOKE_SERIOUS_MARKERS = (
    "not a joke",
    "no joke",
    "not kidding",
    "serious question",
    "being serious",
    "说真的",
    "认真问",
    "不是开玩笑",
)


def should_skip_clarification_for_shadow_chat(text: str) -> bool:
    """Shadow Chat only: skip VoI clarify for obvious humor / non-analytical lines."""
    t = text.strip()
    low = t.lower()
    if any(m in low for m in _JOKE_SERIOUS_MARKERS) or any(m in t for m in ("说真的", "认真问")):
        return False
    if "here is a joke" in low or "here's a joke" in low:
        return True
    if "just kidding" in low or "only joking" in low:
        return True
    if "tell you a joke" in low or "tell me a joke" in low:
        return True
    if "开玩笑" in t or "讲个笑话" in t or "说个笑话" in t:
        return True
    if len(t) < 200 and re.search(r"\bjoke\b", low):
        return True
    if re.search(r"\b(haha|hahaha|lol|lmao)\b", low) and len(t) < 120:
        return True
    return False


def run_personalized_clarify_gate(
    raw: str,
    llm: StructuredPredictLLM | None,
    *,
    profile: UserProfile | None = None,
    recent_messages: list[dict[str, str]] | None = None,
    thread_clarification_events: list[dict[str, Any]] | None = None,
    interaction_purpose: str | None = None,
) -> ClarifyGateResult:
    """Full personalized gate: context → LLM JSON → deterministic rerank → ClarifyGateResult."""
    text = raw.strip()
    events = list(thread_clarification_events or [])
    prof = profile or UserProfile()
    if not text:
        return ClarifyGateResult(need_clarification=False, skip_reason="no_input")
    if interaction_purpose == "shadow_chat" and should_skip_clarification_for_shadow_chat(text):
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason="shadow_chat_non_analytical",
            clarification_meta={"note": "skipped_clarify_shadow_chat_heuristic"},
        )
    if llm is None:
        return ClarifyGateResult(need_clarification=False, skip_reason="no_llm")

    ctx = build_clarification_context(
        text,
        recent_messages or [],
        prof,
        thread_clarification_events=events,
    )
    unknown_hint = UNKNOWN_DIMENSIONS_BY_DOMAIN.get(
        ctx.heuristic_domain, UNKNOWN_DIMENSIONS_BY_DOMAIN["other"]
    )
    prompt = (
        "You are the Personalized Clarification Engine for a decision-support assistant.\n"
        "Pick high value-of-information questions: domain-specific, memory-aware, NOT a generic checklist.\n\n"
        "RULES:\n"
        "- Set should_ask=false when the user message is already specific enough to analyze well.\n"
        "- Never ask budget, urgency, or generic deadline unless domain is finance, scheduling, or the user "
        "  clearly raised money/time as the crux.\n"
        "- Never ask questions that invite stereotypes or broad judgments about protected classes; for social_issue "
        "  ask about framing, specific incident, audience, or goal.\n"
        "- Each candidate must include target_dimension (snake_case) and 2–5 distinct multiple-choice options "
        "  (value + short label).\n"
        "- candidate_questions: 3–5 items; each targets a different missing dimension.\n"
        "- selected_question MUST exactly match one candidate's `question` string.\n"
        "- Use known_about_user + missing_dimensions to avoid repeating what profile/thread already settled.\n"
        "- domain: choose the best fit label from the schema.\n\n"
        f"Likely missing-dimension families for this heuristic domain ({ctx.heuristic_domain}): {unknown_hint}\n\n"
        f"{ctx.to_prompt_block()}\n\n"
        "Return structured JSON matching the schema."
    )
    try:
        out = structured_predict(llm, PersonalizedClarifyLLMOutput, prompt)
        llm_out = out if isinstance(out, PersonalizedClarifyLLMOutput) else PersonalizedClarifyLLMOutput.model_validate(out)
    except Exception:
        return ClarifyGateResult(need_clarification=False, skip_reason="error")

    if _message_clear_enough_to_skip(text) and llm_out.should_ask:
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason="not_needed",
            clarification_meta={
                "domain": llm_out.domain,
                "user_intent": llm_out.user_intent,
                "note": "heuristic_clear_message_override",
            },
        )

    if not llm_out.should_ask:
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason="not_needed",
            clarification_meta={"domain": llm_out.domain, "user_intent": llm_out.user_intent},
        )

    ranked = _pick_candidates_ranked(llm_out, thread_events=events, profile=prof)
    winner = _match_selected_to_candidate(llm_out, ranked)
    if winner is None:
        return ClarifyGateResult(need_clarification=False, skip_reason="no_questions")

    profile_blob = " ".join(
        prof.clarification_priority_texts()
        + [
            format_memory_fact_prompt_line(f)
            for f in user_scope_memory_facts(active_memory_facts(list(prof.memory_facts)))[:24]
        ]
        + prof.profile_channel_priority_texts()
    )
    best_score = final_candidate_score(
        winner, domain=llm_out.domain, thread_events=events, profile_blob=profile_blob
    )
    if best_score < 0.06:
        return ClarifyGateResult(
            need_clarification=False,
            skip_reason="not_needed",
            clarification_meta={"domain": llm_out.domain, "note": "best_candidate_score_too_low"},
        )

    qid = _slug_dim(winner.target_dimension)
    questions = [
        ClarifyQuestion(
            id=qid,
            prompt=winner.question.strip(),
            options=winner.options,
        )
    ]
    second = None
    if len(ranked) > 1:
        s1 = best_score
        s2, c2 = ranked[1]
        if (
            c2.target_dimension != winner.target_dimension
            and s2 > 0.2
            and (s1 - s2) < 0.12
            and repetition_penalty(c2, thread_events=events, profile_blob=profile_blob) < 0.4
        ):
            second = ClarifyQuestion(
                id=_slug_dim(c2.target_dimension),
                prompt=c2.question.strip(),
                options=c2.options,
            )
    if second:
        questions.append(second)

    meta = {
        "domain": llm_out.domain,
        "user_intent": llm_out.user_intent,
        "target_dimension": winner.target_dimension,
        "why_this_question": (winner.why_this_question or "").strip()
        or f"This clarifies {winner.target_dimension}, which is uncertain and relevant to your question.",
        "rerank_score": ranked[0][0] if ranked else None,
    }
    return ClarifyGateResult(
        need_clarification=True,
        questions=questions[:2],
        note="",
        skip_reason="none",
        clarification_meta=meta,
    )


# --- Answer persistence ---------------------------------------------------------

class ClarificationPersistItem(BaseModel):
    dimension: str = Field(min_length=1)
    persistence: Literal["durable_profile", "task_specific", "do_not_store"]
    memory_fact_text: str = Field(default="", max_length=500)
    rationale: str = Field(default="", max_length=400)


class ClarificationPersistPlan(BaseModel):
    items: list[ClarificationPersistItem] = Field(max_length=8)


def _rule_based_persistence(dimension: str, answer_label: str) -> ClarificationPersistItem | None:
    a = answer_label.strip().lower()
    if any(x in a for x in ("prefer not", "rather not say", "none of your", "no comment")):
        return ClarificationPersistItem(
            dimension=dimension, persistence="do_not_store", rationale="user_avoidance_or_pushback"
        )
    if re.search(r"\b(this week|today|tomorrow|friday|monday|the demo|for this)\b", a):
        return ClarificationPersistItem(
            dimension=dimension,
            persistence="task_specific",
            memory_fact_text=answer_label.strip()[:500],
            rationale="time_or_episode_scoped_wording",
        )
    if re.search(r"\b(i (usually|generally|always|tend to)|long.?term|in general|my values)\b", a):
        return ClarificationPersistItem(
            dimension=dimension,
            persistence="durable_profile",
            memory_fact_text=f"{dimension}: {answer_label.strip()}"[:500],
            rationale="stable_preference_language",
        )
    return None


def classify_clarification_persistence(
    *,
    user_message: str,
    answers: dict[str, str],
    llm: StructuredPredictLLM | None,
) -> ClarificationPersistPlan:
    """Classify each clarification answer as durable profile, task-only, or do-not-store."""
    items: list[ClarificationPersistItem] = []
    pending: list[tuple[str, str]] = []
    for dim, label in answers.items():
        dim_s = str(dim).strip()
        ruled = _rule_based_persistence(dim_s, label)
        if ruled:
            items.append(ruled)
        else:
            pending.append((dim_s, label))

    if pending and llm is not None:
        lines = [f"{i + 1}. dimension_id={d!r} answer_label={a!r}" for i, (d, a) in enumerate(pending)]
        prompt = (
            "Classify how to STORE each clarification answer for a decision assistant.\n"
            "- durable_profile: stable preference/fact useful across future sessions.\n"
            "- task_specific: only meaningful for this episode/decision.\n"
            "- do_not_store: sensitive, unsafe to persist, or user declined to share meaningfully.\n\n"
            f"User message context:\n{user_message[:900]}\n\n"
            "Pairs (in order):\n"
            + "\n".join(lines)
            + "\n\nReturn ClarificationPersistPlan with `items` in the SAME ORDER and count. "
            "Each item.dimension must match the dimension_id string exactly."
        )
        try:
            out = structured_predict(llm, ClarificationPersistPlan, prompt)
            plan = out if isinstance(out, ClarificationPersistPlan) else ClarificationPersistPlan.model_validate(out)
            if len(plan.items) == len(pending):
                for (dim_s, label), it in zip(pending, plan.items):
                    items.append(it.model_copy(update={"dimension": dim_s}))
            else:
                by_dim = {str(i.dimension).strip(): i for i in plan.items}
                for dim_s, label in pending:
                    it = by_dim.get(dim_s)
                    if it is None:
                        items.append(
                            ClarificationPersistItem(
                                dimension=dim_s,
                                persistence="task_specific",
                                memory_fact_text=label.strip()[:500],
                                rationale="batch_missing_dimension_fallback",
                            )
                        )
                    else:
                        items.append(it.model_copy(update={"dimension": dim_s}))
        except Exception:
            for dim_s, label in pending:
                items.append(
                    ClarificationPersistItem(
                        dimension=dim_s,
                        persistence="task_specific",
                        memory_fact_text=label.strip()[:500],
                        rationale="classify_error_fallback",
                    )
                )
    elif pending:
        for dim_s, label in pending:
            items.append(
                ClarificationPersistItem(
                    dimension=dim_s,
                    persistence="task_specific",
                    memory_fact_text=label.strip()[:500],
                    rationale="no_llm_default_task_specific",
                )
            )

    return ClarificationPersistPlan(items=items)


def persist_clarification_followup(
    settings: Settings,
    *,
    thread: dict[str, Any] | None,
    user_plain_message: str,
    clarification_answers: dict[str, str],
    save_to_profile_requested: bool,
    llm: StructuredPredictLLM | None,
) -> None:
    """Thread log + optional profile memory + legacy clarification lines."""
    if not clarification_answers:
        return
    plan = classify_clarification_persistence(
        user_message=user_plain_message, answers=clarification_answers, llm=llm
    )
    prof = load_user_profile(settings)
    records: list[ProfileMemoryFact] = []
    clar_dict: dict[str, str] = {}
    from datetime import datetime, timezone

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for dim, label in clarification_answers.items():
        item = next((i for i in plan.items if i.dimension == dim), None)
        if item is None:
            item = ClarificationPersistItem(
                dimension=dim, persistence="task_specific", memory_fact_text=label, rationale="missing_item"
            )
        if thread is not None:
            from foresight_x.chat.thread_store import append_clarification_event as _append_clarification_event

            _append_clarification_event(
                thread,
                kind="answered",
                target_dimension=dim,
                question_prompt="",
                answer_label=label,
                persistence=item.persistence,
            )
        if item.persistence == "do_not_store":
            continue
        if item.persistence == "durable_profile" and save_to_profile_requested:
            txt = (item.memory_fact_text or label).strip()[:500]
            if not txt:
                continue
            records.append(
                ProfileMemoryFact(
                    id=str(uuid.uuid4()),
                    category=MemoryFactCategory.GOALS,
                    text=txt,
                    source="clarification",
                    created_at=ts,
                    subject_ref="user",
                    predicate=f"clarify_{_slug_dim(dim)}",
                    object_value=label.strip()[:500],
                    evidence=(user_plain_message[:220] + " | " + label)[:500],
                    confidence=0.75,
                    qualifiers={
                        "source": "clarification",
                        "target_dimension": dim,
                        "thread_id": str((thread or {}).get("thread_id") or ""),
                        "persistence": item.persistence,
                        "rationale": item.rationale[:200],
                    },
                )
            )
            clar_dict[dim] = label
        elif item.persistence == "task_specific":
            # Thread-only: event already logged; optionally mirror as ephemeral line is skipped
            pass

    if records:
        prof = append_profile_memory_records(prof, records)
    if clar_dict and save_to_profile_requested:
        prof = append_clarification_to_profile(prof, clar_dict)
    if records or (clar_dict and save_to_profile_requested):
        save_user_profile(prof, settings=settings)
