"""LLM-first wellbeing clinical routing — transdiagnostic processes → evidence-based protocols."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.slime.wellbeing_protocols import PROTOCOL_CATALOG, PROTOCOL_IDS, build_protocol_prompt_block
from foresight_x.slime.wellbeing_router import (
    WellbeingRouteResult,
    is_safety_escalation_message,
)

_log = logging.getLogger(__name__)

TRANSDIAGNOSTIC_PROCESSES = (
    "hyperarousal",
    "rumination",
    "avoidance",
    "anhedonia",
    "self_criticism",
    "interpersonal",
    "ambivalence",
    "grief_meaning",
    "problem_overload",
    "decision_conflict",
    "general_distress",
)

# Protocols that count as active technique (vs alliance/listening)
STRUCTURED_PROTOCOLS: frozenset[str] = frozenset(
    {
        "cbt_thought_record",
        "act",
        "behavioral_activation",
        "emotion_regulation",
        "distress_tolerance",
        "motivational_interviewing",
        "interpersonal_therapy",
        "problem_management",
        "decision_support",
    }
)

BODY_SKILLS = frozenset(
    {
        "paced_breathing",
        "5-4-3-2-1",
        "tipp_temperature",
        "tipp_exercise",
        "progressive_relaxation",
    }
)

COUNSELING_MOVES: frozenset[str] = frozenset(
    {
        "accurate_empathy",
        "emotion_labeling",
        "meaning_reflection",
        "double_sided_reflection",
        "gentle_challenge",
        "clarifying_question",
        "summary",
        "repair_mismatch",
        "focus_one_thread",
        "stabilize",
        "collaborative_skill",
        "action_planning",
        "boundary_script",
    }
)

PROTOCOL_FIT_LEVELS: frozenset[str] = frozenset({"none", "light", "structured"})
RESPONSE_TEMPOS: frozenset[str] = frozenset(
    {"slow", "steady", "active", "brief_stabilizing"}
)


class WellbeingTurnAssessment(BaseModel):
    """Structured triage for one user turn (internal; not shown verbatim to user)."""

    intensity_0_10: int = Field(ge=0, le=10, description="Subjective distress right now")
    primary_process: str = Field(
        description="One of: " + ", ".join(TRANSDIAGNOSTIC_PROCESSES)
    )
    recommended_protocol: str = Field(description="One protocol id from PROTOCOL_IDS")
    session_phase: str = Field(
        default="intervention",
        description="rapport | formulation | intervention | consolidate",
    )
    alliance_priority: bool = Field(
        default=False,
        description="True when user mainly needs listening; minimize techniques",
    )
    needs_body_stabilization: bool = Field(
        default=False,
        description="True only for panic/dissociation/impulse surge; not routine stress",
    )
    formulation_note: str = Field(
        default="",
        max_length=280,
        description="Brief case formulation update for this thread",
    )
    rationale_internal: str = Field(default="", max_length=200)
    core_affect: str = Field(
        default="",
        max_length=80,
        description="Surface/core emotion: shame, fear, grief, anger, loneliness, overwhelm, numbness, etc.",
    )
    underlying_need: str = Field(
        default="",
        max_length=120,
        description="Unspoken need: reassurance, rest, autonomy, connection, safety, permission, clarity, etc.",
    )
    maintaining_loop: str = Field(
        default="",
        max_length=200,
        description="Non-diagnostic maintaining cycle in plain language",
    )
    best_counseling_move: str = Field(
        default="accurate_empathy",
        description="Primary micro-skill for this turn",
    )
    response_tempo: str = Field(
        default="steady",
        description="slow | steady | active | brief_stabilizing",
    )
    protocol_fit: str = Field(
        default="none",
        description="none | light | structured — whether a modality worksheet belongs here",
    )
    why_this_move: str = Field(
        default="",
        max_length=200,
        description="Internal rationale for counseling move (not shown to user)",
    )


def _session_context_block(thread: dict[str, Any] | None) -> str:
    if not thread:
        return "(no thread context)"
    from foresight_x.slime.therapy_session import get_therapy_session

    s = get_therapy_session(thread)
    lines = [
        f"status={s.get('status')}",
        f"intake_complete={bool(s.get('intake_complete'))}",
        f"mood_at_intake={s.get('mood_score')}",
        f"primary_concern={ (s.get('primary_concern') or '')[:200] }",
        f"session_goal={ (s.get('session_goal') or '')[:200] }",
        f"support_preference={s.get('support_preference') or 'mixed'}",
        f"last_protocol={s.get('last_protocol')}",
        f"skills_used={s.get('skills_used') or []}",
        f"formulation={ (s.get('formulation_snapshot') or '')[:300] }",
    ]
    notes = s.get("episode_notes") or []
    if notes:
        recent = [n.get("user", "") for n in notes[-3:] if isinstance(n, dict)]
        lines.append("recent_user_themes=" + " | ".join(x for x in recent if x)[:280])
    last_clinical = s.get("last_clinical")
    if isinstance(last_clinical, dict):
        lines.append(
            "last_counseling_move="
            + str(last_clinical.get("best_counseling_move") or "")
            + " | last_protocol_fit="
            + str(last_clinical.get("protocol_fit") or "")
        )
        loop = (last_clinical.get("maintaining_loop") or "").strip()
        if loop:
            lines.append(f"last_maintaining_loop={loop[:180]}")
    return "\n".join(lines)


def _normalize_counseling_move(raw: str) -> str:
    move = (raw or "").strip().lower().replace(" ", "_")
    if move in COUNSELING_MOVES:
        return move
    aliases = {
        "empathy": "accurate_empathy",
        "reflect": "meaning_reflection",
        "reflection": "meaning_reflection",
        "double_sided": "double_sided_reflection",
        "mi": "double_sided_reflection",
        "clarify": "clarifying_question",
        "repair": "repair_mismatch",
        "focus": "focus_one_thread",
        "ground": "stabilize",
        "skill": "collaborative_skill",
        "boundary": "boundary_script",
    }
    return aliases.get(move, "accurate_empathy")


def _normalize_protocol_fit(raw: str) -> str:
    fit = (raw or "").strip().lower()
    if fit in PROTOCOL_FIT_LEVELS:
        return fit
    if fit in ("low", "minimal"):
        return "light"
    if fit in ("high", "full", "worksheet"):
        return "structured"
    return "none"


def _normalize_response_tempo(raw: str) -> str:
    tempo = (raw or "").strip().lower().replace(" ", "_")
    if tempo in RESPONSE_TEMPOS:
        return tempo
    if tempo in ("brief", "stabilizing", "stabilise"):
        return "brief_stabilizing"
    return "steady"


def _is_grief_context(low: str) -> bool:
    return bool(
        re.search(
            r"\b(grief|grieving|mourning|died|passed away|death of|lost (him|her|them|someone)|"
            r"funeral|miss them|miss him|miss her)\b",
            low,
        )
    )


def _is_relationship_conflict(low: str) -> bool:
    if _is_grief_context(low):
        return False
    if re.search(
        r"\b(boundary|argument|fight with|fighting with|conflict with|won't listen|"
        r"not listening|text them|needy|angry at|hurt me|betrayed|cheated|broke up with)\b",
        low,
    ):
        return True
    return bool(
        re.search(r"\b(partner|boyfriend|girlfriend|spouse|husband|wife)\b", low)
        and re.search(r"\b(fight|argu|conflict|boundary|won't|angry|hurt|betray)\b", low)
    )


def _user_turn_signals(user_message: str) -> dict[str, bool]:
    low = (user_message or "").lower()
    grief = _is_grief_context(low)
    return {
        "grief_context": grief,
        "wants_skill": bool(
            re.search(
                r"\b(what can i do|how do i|help me (fix|cope|handle)|give me (a |an )?(tool|tip|exercise|skill)|"
                r"teach me|walk me through|step by step|something practical)\b",
                low,
            )
            or re.search(r"(怎么办|怎么做|给我.*(建议|方法|技巧))", low)
        ),
        "wants_listen": bool(
            re.search(
                r"\b(just (listen|vent|talk)|don't (fix|advise|tell me what)|no advice|only listen|"
                r"hear me out|i just need to)\b",
                low,
            )
            or re.search(r"(只听|不要建议|不要劝|别教我|听我说|只想.*听)", low)
        ),
        "pushes_back": bool(
            re.search(
                r"\b(didn't work|doesn't work|not helpful|useless|stop (telling|giving)|"
                r"you're not listening|don't lecture|that advice|already tried that)\b",
                low,
            )
            or re.search(r"(没用|没有用|你根本不听|别说了|别劝了)", low)
        ),
        "shame_self_attack": bool(
            re.search(
                r"\b(ashamed|shame|hate myself|i'm (so )?(stupid|pathetic|worthless|a failure)|"
                r"disgusting|not good enough|i ruin everything)\b",
                low,
            )
        ),
        "panic_arousal": bool(
            re.search(
                r"\b(panic|panicking|can't breathe|heart racing|spiraling|freaking out|"
                r"dissociat|numb and unreal|losing control)\b",
                low,
            )
        ),
        "overload_confusion": bool(
            re.search(
                r"\b(overwhelm|too much|can't think|everything at once|don't know where to start|"
                r"brain fog|scattered)\b",
                low,
            )
        ),
        "relationship_conflict": _is_relationship_conflict(low),
        "ambivalence": bool(
            re.search(
                r"\b(part of me|on one hand|not sure i want|keep saying i will|maybe i should quit|"
                r"don't know if i should)\b",
                low,
            )
        ),
    }


def _consecutive_technique_turns(session: dict[str, Any]) -> int:
    return max(0, int(session.get("technique_turn_streak") or 0))


_TECHNIQUE_FORWARD_MOVES: frozenset[str] = frozenset(
    {"collaborative_skill", "action_planning"}
)


def _alliance_move_for_signals(signals: dict[str, bool]) -> str:
    if signals.get("shame_self_attack"):
        return "emotion_labeling"
    if signals.get("overload_confusion"):
        return "clarifying_question"
    if signals.get("grief_context"):
        return "meaning_reflection"
    if signals.get("ambivalence"):
        return "double_sided_reflection"
    return "accurate_empathy"


def _finalize_assessment_fields(
    data: dict[str, Any],
    *,
    user_message: str,
    signals: dict[str, bool],
) -> dict[str, Any]:
    """Normalize counseling-move fields and enforce protocol_fit gate."""
    data["best_counseling_move"] = _normalize_counseling_move(str(data.get("best_counseling_move") or ""))
    data["protocol_fit"] = _normalize_protocol_fit(str(data.get("protocol_fit") or ""))
    data["response_tempo"] = _normalize_response_tempo(str(data.get("response_tempo") or ""))
    data["recommended_protocol"] = _normalize_protocol_id(str(data.get("recommended_protocol") or ""))

    fit = data["protocol_fit"]
    pid = data["recommended_protocol"]
    high_arousal = bool(
        signals.get("panic_arousal")
        or data.get("needs_body_stabilization")
        or data.get("response_tempo") == "brief_stabilizing"
    )
    if fit == "none":
        if pid in STRUCTURED_PROTOCOLS:
            data["recommended_protocol"] = "supportive_reflection"
        data["alliance_priority"] = True
        if not high_arousal and data.get("recommended_protocol") != "safety_escalation":
            data["session_phase"] = "rapport"
        if data["best_counseling_move"] in _TECHNIQUE_FORWARD_MOVES:
            data["best_counseling_move"] = _alliance_move_for_signals(signals)
    elif fit == "light" and pid in STRUCTURED_PROTOCOLS:
        data["alliance_priority"] = True

    if signals.get("panic_arousal") or data.get("needs_body_stabilization"):
        data["response_tempo"] = "brief_stabilizing"
        data.setdefault("best_counseling_move", "stabilize")
    elif signals.get("shame_self_attack") and data["best_counseling_move"] == "collaborative_skill":
        data["best_counseling_move"] = "emotion_labeling"

    low = (user_message or "").lower()
    if not data.get("core_affect"):
        if signals.get("shame_self_attack"):
            data["core_affect"] = "shame"
        elif signals.get("panic_arousal"):
            data["core_affect"] = "fear"
        elif signals.get("overload_confusion"):
            data["core_affect"] = "overwhelm"
        elif re.search(r"\b(lonely|alone)\b", low):
            data["core_affect"] = "loneliness"
        elif re.search(r"\b(angry|furious|resent)\b", low):
            data["core_affect"] = "anger"
        elif re.search(r"\b(grief|grieving|miss them)\b", low):
            data["core_affect"] = "grief"

    return data


def apply_balanced_routing(
    assessment: WellbeingTurnAssessment,
    user_message: str,
    thread: dict[str, Any] | None,
) -> WellbeingTurnAssessment:
    """
    Post-triage balance: counseling micro-skills first; protocols only when fit is real.
    """
    if assessment.recommended_protocol == "safety_escalation":
        return assessment.model_copy(
            update={
                "best_counseling_move": "stabilize",
                "response_tempo": "brief_stabilizing",
                "protocol_fit": "none",
                "why_this_move": (assessment.why_this_move or "safety_escalation"),
            }
        )

    from foresight_x.slime.therapy_session import get_therapy_session

    s = get_therapy_session(thread)
    pref = str(s.get("support_preference") or "mixed")
    signals = _user_turn_signals(user_message)
    streak = _consecutive_technique_turns(s)
    intensity = assessment.intensity_0_10
    pid = _normalize_protocol_id(assessment.recommended_protocol)
    fit = _normalize_protocol_fit(assessment.protocol_fit)
    move = _normalize_counseling_move(assessment.best_counseling_move)
    tempo = _normalize_response_tempo(assessment.response_tempo)

    updates: dict[str, Any] = {
        "protocol_fit": fit,
        "best_counseling_move": move,
        "response_tempo": tempo,
    }

    # User pushed back on advice — repair, do not push another technique
    if signals["pushes_back"]:
        merged = _finalize_assessment_fields(
            {
                **assessment.model_dump(),
                "recommended_protocol": "supportive_reflection",
                "alliance_priority": True,
                "protocol_fit": "none",
                "best_counseling_move": "repair_mismatch",
                "response_tempo": "slow",
                "session_phase": "rapport",
                "why_this_move": "User rejected prior advice — repair alliance",
                "rationale_internal": (assessment.rationale_internal or "") + "|repair_mismatch",
            },
            user_message=user_message,
            signals=signals,
        )
        return WellbeingTurnAssessment.model_validate(merged)

    # Rule: 2+ consecutive technique turns → listening (unless panic still needs stabilization)
    if (
        streak >= 2
        and pid in STRUCTURED_PROTOCOLS
        and not (signals["panic_arousal"] or assessment.needs_body_stabilization)
    ):
        repair_move = "repair_mismatch" if streak >= 3 else "meaning_reflection"
        merged = _finalize_assessment_fields(
            {
                **assessment.model_dump(),
                **updates,
                "recommended_protocol": "supportive_reflection",
                "alliance_priority": True,
                "protocol_fit": "none",
                "best_counseling_move": repair_move,
                "response_tempo": "slow",
                "session_phase": "rapport",
                "rationale_internal": (assessment.rationale_internal or "") + "|balance_streak",
                "why_this_move": "Too many technique turns — return to alliance",
            },
            user_message=user_message,
            signals=signals,
        )
        return WellbeingTurnAssessment.model_validate(merged)

    # High intensity, non-crisis: distinguish panic vs shame vs overload
    if intensity >= 7 and not signals["wants_skill"]:
        if signals["panic_arousal"] or assessment.needs_body_stabilization:
            updates.update(
                {
                    "needs_body_stabilization": True,
                    "recommended_protocol": "distress_tolerance",
                    "protocol_fit": "light",
                    "best_counseling_move": "stabilize",
                    "response_tempo": "brief_stabilizing",
                    "alliance_priority": True,
                    "why_this_move": "Panic-level arousal — brief stabilization first",
                }
            )
        elif signals["shame_self_attack"]:
            updates.update(
                {
                    "recommended_protocol": "supportive_reflection",
                    "protocol_fit": "light",
                    "best_counseling_move": "emotion_labeling",
                    "response_tempo": "slow",
                    "alliance_priority": True,
                    "session_phase": "rapport",
                    "why_this_move": "Shame/self-attack — soften before any CBT worksheet",
                }
            )
        elif signals["overload_confusion"]:
            updates.update(
                {
                    "recommended_protocol": "problem_management",
                    "protocol_fit": "light",
                    "best_counseling_move": "focus_one_thread",
                    "response_tempo": "slow",
                    "alliance_priority": True,
                    "why_this_move": "Overload — narrow to one thread, light PM+ only",
                }
            )

    if signals["wants_skill"] and intensity >= 5 and pid == "supportive_reflection":
        proc = assessment.primary_process
        skill_map = {
            "rumination": ("cbt_thought_record", "light", "collaborative_skill"),
            "self_criticism": ("cbt_thought_record", "light", "gentle_challenge"),
            "avoidance": ("behavioral_activation", "light", "action_planning"),
            "anhedonia": ("behavioral_activation", "light", "action_planning"),
            "ambivalence": ("motivational_interviewing", "light", "double_sided_reflection"),
            "interpersonal": ("interpersonal_therapy", "light", "boundary_script"),
            "problem_overload": ("problem_management", "light", "focus_one_thread"),
            "decision_conflict": ("decision_support", "light", "clarifying_question"),
            "grief_meaning": ("act", "light", "meaning_reflection"),
        }
        if proc in skill_map:
            proto, pfit, cm = skill_map[proc]
            updates["recommended_protocol"] = proto
            updates["protocol_fit"] = pfit
            updates["best_counseling_move"] = cm
            updates["alliance_priority"] = False
            updates["session_phase"] = "intervention"

    # Process-specific counseling moves (explicit assignment — do not rely on setdefault vs initial move)
    if (
        signals["ambivalence"]
        and not signals["wants_listen"]
        and not signals["panic_arousal"]
        and not signals["pushes_back"]
    ):
        updates.update(
            {
                "recommended_protocol": "motivational_interviewing",
                "protocol_fit": "light",
                "best_counseling_move": "double_sided_reflection",
            }
        )
    elif (
        signals["relationship_conflict"]
        and not signals["panic_arousal"]
        and not signals["wants_listen"]
        and not signals["grief_context"]
        and not signals["pushes_back"]
    ):
        updates.update(
            {
                "recommended_protocol": "interpersonal_therapy",
                "protocol_fit": "light",
                "best_counseling_move": "boundary_script",
            }
        )
    elif signals["grief_context"] and not signals["wants_skill"]:
        updates["best_counseling_move"] = "meaning_reflection"
        updates["recommended_protocol"] = "supportive_reflection"
        updates["protocol_fit"] = "none"
        updates["primary_process"] = "grief_meaning"
        updates["alliance_priority"] = True

    # Listen intent overrides process routing (except pushback and active panic stabilization)
    if signals["wants_listen"] and not signals["pushes_back"]:
        updates["alliance_priority"] = True
        updates["response_tempo"] = "slow"
        if signals["panic_arousal"] or assessment.needs_body_stabilization:
            updates["protocol_fit"] = "light"
            updates["best_counseling_move"] = "stabilize"
            updates.setdefault("recommended_protocol", "distress_tolerance")
            updates.setdefault("needs_body_stabilization", True)
        else:
            updates["protocol_fit"] = "none"
            updates["best_counseling_move"] = "meaning_reflection"
            updates["recommended_protocol"] = "supportive_reflection"
            updates["session_phase"] = "rapport"

    # Intensity bands — moderate distress does NOT auto-route to worksheets
    if intensity <= 4 and not signals["wants_skill"]:
        if pid in STRUCTURED_PROTOCOLS and pref != "structured":
            updates.setdefault("recommended_protocol", "supportive_reflection")
            updates.setdefault("protocol_fit", "none")
        updates.setdefault("alliance_priority", True)
        updates.setdefault("session_phase", "rapport")
        updates.setdefault("best_counseling_move", "accurate_empathy")
    elif 5 <= intensity <= 7 and pref == "mixed":
        if (
            not signals["wants_skill"]
            and not signals["wants_listen"]
            and pid in STRUCTURED_PROTOCOLS
            and assessment.primary_process == "general_distress"
            and fit != "structured"
        ):
            updates.setdefault("recommended_protocol", "supportive_reflection")
            updates.setdefault("protocol_fit", "none")
            updates.setdefault("alliance_priority", True)
            updates.setdefault("best_counseling_move", "meaning_reflection")
    elif pref == "listen" and not signals["wants_skill"] and intensity < 8:
        if pid in STRUCTURED_PROTOCOLS:
            updates.setdefault("recommended_protocol", "supportive_reflection")
        updates.setdefault("protocol_fit", "none")
        updates.setdefault("alliance_priority", True)
        updates.setdefault("best_counseling_move", "meaning_reflection")
        updates.setdefault("response_tempo", "slow")
    elif pref == "structured" and intensity >= 5 and pid == "supportive_reflection":
        if assessment.primary_process in ("rumination", "self_criticism"):
            updates.setdefault("recommended_protocol", "cbt_thought_record")
            updates.setdefault("protocol_fit", "structured")
            updates.setdefault("best_counseling_move", "collaborative_skill")
        elif assessment.primary_process in ("avoidance", "anhedonia"):
            updates.setdefault("recommended_protocol", "behavioral_activation")
            updates.setdefault("protocol_fit", "light")
            updates.setdefault("best_counseling_move", "action_planning")

    merged = _finalize_assessment_fields(
        {**assessment.model_dump(), **updates},
        user_message=user_message,
        signals=signals,
    )
    if merged.get("primary_process") not in TRANSDIAGNOSTIC_PROCESSES:
        merged["primary_process"] = assessment.primary_process
    tag = merged.get("rationale_internal") or ""
    if "balance" not in tag and updates != {"protocol_fit": fit, "best_counseling_move": move, "response_tempo": tempo}:
        merged["rationale_internal"] = (tag + "|balance").strip("|")
    return WellbeingTurnAssessment.model_validate(merged)


def _build_classifier_prompt(user_message: str, thread: dict[str, Any] | None) -> str:
    catalog = json.dumps(PROTOCOL_CATALOG, indent=2, ensure_ascii=False)
    moves = ", ".join(sorted(COUNSELING_MOVES))
    return f"""You are an internal case-formulation assistant for Rimumu (NON-CLINICAL emotional support).
Do NOT diagnose disorders. Your output guides counseling style — not a worksheet dump.

Workflow (internal):
1) Formulate: what is the user stuck on right now (core_affect, underlying_need, maintaining_loop)?
2) Choose ONE best_counseling_move from: {moves}
3) Set protocol_fit (none | light | structured) — counseling moves ALWAYS come first.
4) Pick recommended_protocol only if protocol_fit is light/structured AND user readiness/language fit.

Counseling-first rules:
- If the user wants to be heard → accurate_empathy / meaning_reflection / clarifying_question; protocol_fit none or light.
- Do NOT route moderate distress (5-7) to structured CBT/ACT/DBT automatically.
- If user rejects advice ("didn't work", "useless") → repair_mismatch; protocol_fit none.
- Shame/self-attack → emotion_labeling or meaning_reflection; CBT at most light (no full worksheet).
- Panic/body arousal/impulse surge → stabilize; distress_tolerance; response_tempo brief_stabilizing.
- Overload/confusion → focus_one_thread; problem_management light only.
- Ambivalence → double_sided_reflection; motivational_interviewing light.
- Relationship/boundary conflict → boundary_script or interpersonal_therapy light.
- Low energy/withdrawal → behavioral_activation with tiny steps only.

Protocol rules (when fit is real):
- safety_escalation ONLY for self-harm, suicide, harm to others, abuse in danger, psychosis, medical emergency.
- distress_tolerance ONLY when needs_body_stabilization (panic, dissociation, overwhelming arousal).
- Avoid repeating body skills in skills_used unless intensity >= 9.
- support_preference=listen → protocol_fit none/light unless user asks for tools or stabilization needed.
- support_preference=structured → structured only when process is clear and user can engage.

response_tempo: slow (overwhelm/shame), steady (default), active (motivated skill-seeking), brief_stabilizing (panic).
why_this_move: one short internal sentence (max 200 chars).

Protocol catalog (ids must match exactly):
{catalog}

--- Thread context ---
{_session_context_block(thread)}

--- User message ---
{(user_message or '').strip()[:2000]}

Return JSON matching the schema exactly."""


def _normalize_protocol_id(raw: str) -> str:
    pid = (raw or "").strip().lower().replace(" ", "_")
    aliases = {
        "act": "act",
        "acceptance_commitment": "act",
        "ipt": "interpersonal_therapy",
        "relationship": "interpersonal_therapy",
        "relationship_script": "interpersonal_therapy",
        "mi": "motivational_interviewing",
        "ba": "behavioral_activation",
        "cbt": "cbt_thought_record",
        "dbt_distress": "distress_tolerance",
        "dbt_emotion": "emotion_regulation",
        "pm+": "problem_management",
        "pm_plus": "problem_management",
        "humanistic": "supportive_reflection",
    }
    if pid in aliases:
        return aliases[pid]
    if pid in PROTOCOL_IDS:
        return pid
    return "supportive_reflection"


def _assessment_from_llm(llm: Any, user_message: str, thread: dict[str, Any] | None) -> WellbeingTurnAssessment | None:
    from foresight_x.structured_predict import structured_predict

    try:
        out = structured_predict(llm, WellbeingTurnAssessment, _build_classifier_prompt(user_message, thread))
        if hasattr(out, "model_dump"):
            data = out.model_dump(mode="json")
        else:
            data = WellbeingTurnAssessment.model_validate(out).model_dump(mode="json")
        data["recommended_protocol"] = _normalize_protocol_id(str(data.get("recommended_protocol") or ""))
        proc = str(data.get("primary_process") or "general_distress").strip().lower()
        if proc not in TRANSDIAGNOSTIC_PROCESSES:
            data["primary_process"] = "general_distress"
        signals = _user_turn_signals(user_message)
        data = _finalize_assessment_fields(data, user_message=user_message, signals=signals)
        return WellbeingTurnAssessment.model_validate(data)
    except Exception:
        _log.debug("wellbeing LLM triage failed", exc_info=True)
        return None


def _score_protocols(user_message: str, thread: dict[str, Any] | None) -> WellbeingTurnAssessment:
    """Fallback: multi-signal scoring (used when LLM unavailable). Not single-regex routing."""
    from foresight_x.slime.therapy_session import get_therapy_session

    low = (user_message or "").lower()
    s = get_therapy_session(thread)
    pref = str(s.get("support_preference") or "mixed")
    skills = set(s.get("skills_used") or [])

    scores: dict[str, float] = {p: 0.0 for p in PROTOCOL_IDS}

    # Intensity heuristics
    intensity = int(s.get("mood_score") or 5)
    if re.search(r"\b(panic|panicking|can't breathe|heart racing|dissociat|numb|unreal)\b", low):
        intensity = max(intensity, 8)
    if re.search(r"\b(a little|kind of|somewhat|mildly)\b", low):
        intensity = min(intensity, 5)
    if re.search(r"\b(overwhelm|terrified|can't cope|breaking down)\b", low):
        intensity = max(intensity, 7)

    # Process signals (weighted, multiple can fire)
    if re.search(r"\b(panic|panicking|spiral|freaking out|can't calm)\b", low):
        scores["distress_tolerance"] += 2.0
        scores["emotion_regulation"] += 1.5
    if re.search(r"\b(self[- ]?crit|hate myself|i'm (so )?stupid|worthless|not good enough)\b", low):
        scores["cbt_thought_record"] += 2.0
        scores["supportive_reflection"] += 1.2
    if re.search(r"\b(ruminat|overthink|can't stop thinking|what if|mind keeps)\b", low):
        scores["cbt_thought_record"] += 2.5
        scores["act"] += 1.5
    if re.search(r"\b(over because|ruined|hopeless|failure|failed|never recover|career is over)\b", low):
        scores["cbt_thought_record"] += 2.2
        scores["act"] += 1.0
    if re.search(r"\b(avoid|avoiding|procrastinat|can't get out of bed|haven't showered|stuck)\b", low):
        scores["behavioral_activation"] += 2.5
        scores["act"] += 1.0
    if re.search(r"\b(no energy|nothing matters|empty|no motivation|anhedon)\b", low):
        scores["behavioral_activation"] += 2.0
        scores["supportive_reflection"] += 1.0
    if _is_relationship_conflict(low):
        scores["interpersonal_therapy"] += 2.5
    if _is_grief_context(low):
        scores["supportive_reflection"] += 2.5
        scores["act"] += 0.8
        scores["interpersonal_therapy"] *= 0.3
    if re.search(r"\b(drink|drinking|smoking|habit|keep saying i will|ambival|becoming a problem)\b", low):
        scores["motivational_interviewing"] += 2.5
    if re.search(r"\b(too many|everything at once|don't know where to start)\b", low):
        scores["problem_management"] += 2.5
    if re.search(r"\b(should i|which option|decide between|choice)\b", low):
        scores["decision_support"] += 2.0
    if re.search(r"\b(grief|lost someone|passed away|meaningless|purpose)\b", low):
        scores["supportive_reflection"] += 2.0
        scores["act"] += 1.0
    max_structured = max(scores[p] for p in STRUCTURED_PROTOCOLS)
    if re.search(r"\b(stress|anxious|worried|tense)\b", low) and max_structured < 2.0:
        scores["supportive_reflection"] += 1.5
        scores["cbt_thought_record"] += 1.0
        scores["problem_management"] += 0.8

    # Balanced baseline: alliance is always viable
    scores["supportive_reflection"] += 1.2

    # Down-rank distress if not high intensity
    if intensity < 8:
        scores["distress_tolerance"] *= 0.35

    signals = _user_turn_signals(user_message)
    streak = _consecutive_technique_turns(s)

    if streak >= 2:
        scores["supportive_reflection"] += 3.0
        for p in list(scores.keys()):
            if p not in ("supportive_reflection", "safety_escalation"):
                scores[p] *= 0.25

    if signals["wants_listen"]:
        scores["supportive_reflection"] += 2.5
        for p in list(scores.keys()):
            if p not in ("supportive_reflection", "safety_escalation"):
                scores[p] *= 0.5
    elif signals["wants_skill"] and intensity >= 5:
        scores["supportive_reflection"] *= 0.6

    if pref == "listen" and not signals["wants_skill"]:
        scores["supportive_reflection"] += 1.5
        for p in list(scores.keys()):
            if p not in ("supportive_reflection", "safety_escalation"):
                scores[p] *= 0.75
    elif pref == "structured" and intensity >= 5:
        for p in STRUCTURED_PROTOCOLS:
            scores[p] += 0.6
    # mixed: no extra skew — process signals + baseline decide

    if intensity <= 4 and not signals["wants_skill"]:
        for p in STRUCTURED_PROTOCOLS:
            scores[p] *= 0.55

    # Penalize body protocols if already used
    if skills & BODY_SKILLS and intensity < 9:
        scores["distress_tolerance"] *= 0.4

    best = max(scores.items(), key=lambda x: x[1])[0]
    if scores[best] < 0.5:
        best = "supportive_reflection"

    process = "general_distress"
    if best == "cbt_thought_record":
        process = "self_criticism" if re.search(r"\b(self[- ]?crit|hate myself|worthless)\b", low) else "rumination"
    elif best in ("distress_tolerance", "emotion_regulation"):
        process = "hyperarousal"
    elif best == "behavioral_activation":
        process = "avoidance" if "avoid" in low else "anhedonia"
    elif best == "interpersonal_therapy":
        process = "interpersonal"
    elif best == "motivational_interviewing":
        process = "ambivalence"
    elif best == "problem_management":
        process = "problem_overload"
    elif best == "decision_support":
        process = "decision_conflict"
    elif best == "act":
        process = "rumination" if "think" in low else "avoidance"

    needs_body = best == "distress_tolerance" and intensity >= 8
    protocol_fit = "none"
    counseling_move = "accurate_empathy"
    tempo = "steady"
    core_affect = ""
    underlying_need = ""
    maintaining_loop = ""
    why = "scoring_fallback"

    if signals["pushes_back"]:
        best = "supportive_reflection"
        protocol_fit = "none"
        counseling_move = "repair_mismatch"
        tempo = "slow"
        why = "User pushed back on prior advice"
    elif signals["panic_arousal"] and intensity >= 7:
        best = "distress_tolerance"
        protocol_fit = "light"
        counseling_move = "stabilize"
        tempo = "brief_stabilizing"
        core_affect = "fear"
        needs_body = True
        why = "Panic-level arousal — stabilize first"
    elif signals["shame_self_attack"]:
        best = "supportive_reflection"
        protocol_fit = "light"
        counseling_move = "emotion_labeling"
        tempo = "slow"
        core_affect = "shame"
        why = "Shame/self-attack — label and soften before CBT"
    elif signals["overload_confusion"]:
        best = "problem_management"
        protocol_fit = "light"
        counseling_move = "focus_one_thread"
        tempo = "slow"
        core_affect = "overwhelm"
        why = "Overload — one thread at a time"
    elif signals["ambivalence"]:
        best = "motivational_interviewing"
        protocol_fit = "light"
        counseling_move = "double_sided_reflection"
        why = "Ambivalence — reflect both sides"
    elif signals["relationship_conflict"]:
        best = "interpersonal_therapy"
        protocol_fit = "light"
        counseling_move = "boundary_script"
        why = "Interpersonal stress — boundary/communication support"
    elif signals["wants_listen"] or (pref == "listen" and not signals["wants_skill"]):
        best = "supportive_reflection"
        protocol_fit = "none"
        counseling_move = "meaning_reflection"
        tempo = "slow"
        why = "User wants listening"
    elif best in STRUCTURED_PROTOCOLS and signals["wants_skill"]:
        protocol_fit = "light" if intensity < 8 else "structured"
        counseling_move = "collaborative_skill"
        why = f"Process-matched skill ({best}) with user consent signal"
    elif best in STRUCTURED_PROTOCOLS:
        protocol_fit = "light"
        counseling_move = "collaborative_skill"

    if streak >= 2 and not signals["panic_arousal"]:
        best = "supportive_reflection"
        protocol_fit = "none"
        counseling_move = "meaning_reflection" if streak < 3 else "repair_mismatch"
        tempo = "slow"

    if signals["grief_context"] and not signals["wants_skill"] and not signals["relationship_conflict"]:
        best = "supportive_reflection"
        protocol_fit = "none"
        counseling_move = "meaning_reflection"
        process = "grief_meaning"
        why = "Grief — presence and meaning, not interpersonal scripts"

    return WellbeingTurnAssessment(
        intensity_0_10=min(10, max(0, intensity)),
        primary_process=process,
        recommended_protocol=best,
        session_phase="rapport"
        if (pref == "listen" or intensity <= 4) and best == "supportive_reflection"
        else "intervention",
        alliance_priority=pref == "listen"
        or (best == "supportive_reflection" and intensity <= 5)
        or protocol_fit == "none",
        needs_body_stabilization=needs_body,
        formulation_note="",
        rationale_internal="scoring_fallback",
        core_affect=core_affect,
        underlying_need=underlying_need,
        maintaining_loop=maintaining_loop,
        best_counseling_move=counseling_move,
        response_tempo=tempo,
        protocol_fit=protocol_fit,
        why_this_move=why,
    )


def assess_wellbeing_turn(
    user_message: str,
    thread: dict[str, Any] | None = None,
    *,
    llm: Any | None = None,
) -> WellbeingTurnAssessment:
    """Primary triage entry — safety regex first, then LLM, then scoring fallback."""
    if is_safety_escalation_message(user_message):
        return WellbeingTurnAssessment(
            intensity_0_10=10,
            primary_process="hyperarousal",
            recommended_protocol="safety_escalation",
            session_phase="intervention",
            needs_body_stabilization=True,
            rationale_internal="safety_regex",
            best_counseling_move="stabilize",
            response_tempo="brief_stabilizing",
            protocol_fit="none",
            why_this_move="Safety escalation — crisis protocol",
        )

    if llm is not None:
        assessed = _assessment_from_llm(llm, user_message, thread)
        if assessed is not None:
            # Post-validate: don't allow distress_tolerance for low intensity unless LLM flagged body need
            if (
                assessed.recommended_protocol == "distress_tolerance"
                and assessed.intensity_0_10 < 8
                and not assessed.needs_body_stabilization
            ):
                assessed = assessed.model_copy(
                    update={
                        "recommended_protocol": "emotion_regulation"
                        if assessed.intensity_0_10 >= 6
                        else "supportive_reflection"
                    }
                )
            return apply_balanced_routing(assessed, user_message, thread)

    scored = _score_protocols(user_message, thread)
    return apply_balanced_routing(scored, user_message, thread)


def route_wellbeing_protocol(
    text: str,
    thread: dict[str, Any] | None = None,
    *,
    llm: Any | None = None,
) -> WellbeingRouteResult:
    """Route to protocol prompt block using clinical assessment."""
    assessment = assess_wellbeing_turn(text, thread, llm=llm)
    pid = _normalize_protocol_id(assessment.recommended_protocol)

    if pid == "safety_escalation":
        return WellbeingRouteResult(
            protocol=pid,
            safety_escalation=True,
            prompt_block=build_protocol_prompt_block(pid),
            assessment=assessment.model_dump(mode="json"),
        )

    block = build_protocol_prompt_block(
        pid,
        assessment=assessment,
        thread=thread,
    )
    return WellbeingRouteResult(
        protocol=pid,
        safety_escalation=False,
        prompt_block=block,
        assessment=assessment.model_dump(mode="json"),
    )


def apply_clinical_assessment_to_session(
    thread: dict[str, Any],
    assessment: WellbeingTurnAssessment,
    *,
    assistant_preview: str = "",
) -> None:
    """Persist triage + formulation on therapy_session for continuity."""
    from foresight_x.slime.therapy_session import get_therapy_session, _sync_thread_sessions

    session = get_therapy_session(thread)
    skills = list(session.get("skills_used") or [])
    low = (assistant_preview or "").lower()
    for skill, patterns in (
        ("paced_breathing", ("breath", "inhale", "exhale", "4-6", "4-7-8")),
        ("5-4-3-2-1", ("5-4-3-2-1", "5 things you see", "five things")),
        ("urge_surfing", ("urge surf",)),
        ("opposite_action", ("opposite action",)),
    ):
        if any(p in low for p in patterns) and skill not in skills:
            skills.append(skill)
    skills = skills[-10:]

    if assessment.needs_body_stabilization and assessment.recommended_protocol == "distress_tolerance":
        if "paced_breathing" not in skills and "breath" in low:
            skills.append("paced_breathing")

    form = (assessment.formulation_note or "").strip()
    if form:
        session["formulation_snapshot"] = form[:500]

    session["last_clinical"] = assessment.model_dump(mode="json")
    session["last_intensity"] = assessment.intensity_0_10
    session["last_process"] = assessment.primary_process
    session["last_protocol"] = assessment.recommended_protocol
    session["session_phase"] = assessment.session_phase
    session["skills_used"] = skills
    pid = _normalize_protocol_id(assessment.recommended_protocol)
    pfit = _normalize_protocol_fit(assessment.protocol_fit)
    if pid in STRUCTURED_PROTOCOLS and pfit != "none":
        session["technique_turn_streak"] = int(session.get("technique_turn_streak") or 0) + 1
    else:
        session["technique_turn_streak"] = 0
    _sync_thread_sessions(thread, session)
