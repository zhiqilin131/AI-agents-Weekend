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
    return "\n".join(lines)


def _user_turn_signals(user_message: str) -> dict[str, bool]:
    low = (user_message or "").lower()
    return {
        "wants_skill": bool(
            re.search(
                r"\b(what can i do|how do i|help me (fix|cope|handle)|give me (a |an )?(tool|tip|exercise|skill)|"
                r"teach me|walk me through|step by step|something practical)\b",
                low,
            )
        ),
        "wants_listen": bool(
            re.search(
                r"\b(just (listen|vent|talk)|don't (fix|advise|tell me what)|no advice|only listen|"
                r"hear me out|i just need to)\b",
                low,
            )
        ),
    }


def _consecutive_technique_turns(session: dict[str, Any]) -> int:
    return max(0, int(session.get("technique_turn_streak") or 0))


def apply_balanced_routing(
    assessment: WellbeingTurnAssessment,
    user_message: str,
    thread: dict[str, Any] | None,
) -> WellbeingTurnAssessment:
    """
    Post-triage balance: humanistic alliance + process-matched modules.
    Neither defaults to breathing nor blocks skills when they fit.
    """
    if assessment.recommended_protocol == "safety_escalation":
        return assessment

    from foresight_x.slime.therapy_session import get_therapy_session

    s = get_therapy_session(thread)
    pref = str(s.get("support_preference") or "mixed")
    signals = _user_turn_signals(user_message)
    streak = _consecutive_technique_turns(s)
    intensity = assessment.intensity_0_10
    pid = _normalize_protocol_id(assessment.recommended_protocol)

    updates: dict[str, Any] = {}

    # Rule: 2+ consecutive technique turns → alliance-only this turn
    if streak >= 2 and pid in STRUCTURED_PROTOCOLS:
        return assessment.model_copy(
            update={
                "recommended_protocol": "supportive_reflection",
                "alliance_priority": True,
                "session_phase": "rapport",
                "rationale_internal": (assessment.rationale_internal or "") + "|balance_streak",
            }
        )

    if signals["wants_listen"]:
        updates["alliance_priority"] = True
        if intensity < 8 and pid in STRUCTURED_PROTOCOLS:
            updates["recommended_protocol"] = "supportive_reflection"
            updates["session_phase"] = "rapport"

    elif signals["wants_skill"] and intensity >= 5 and pid == "supportive_reflection":
        # User asked for something practical — allow process-matched module if triage was vague
        proc = assessment.primary_process
        skill_map = {
            "rumination": "cbt_thought_record",
            "self_criticism": "cbt_thought_record",
            "avoidance": "behavioral_activation",
            "anhedonia": "behavioral_activation",
            "ambivalence": "motivational_interviewing",
            "interpersonal": "interpersonal_therapy",
            "problem_overload": "problem_management",
            "decision_conflict": "decision_support",
            "grief_meaning": "act",
        }
        if proc in skill_map:
            updates["recommended_protocol"] = skill_map[proc]
            updates["alliance_priority"] = False
            updates["session_phase"] = "intervention"

    # Intensity bands (balanced — not always listening, not always CBT)
    if intensity <= 4 and not signals["wants_skill"]:
        if pid in STRUCTURED_PROTOCOLS and pref != "structured":
            updates.setdefault("recommended_protocol", "supportive_reflection")
        updates.setdefault("alliance_priority", True)
        updates.setdefault("session_phase", "rapport")
    elif 5 <= intensity <= 7 and pref == "mixed":
        # Mixed default: reflect first unless clear process + no listen signal
        if (
            not signals["wants_skill"]
            and not signals["wants_listen"]
            and pid in STRUCTURED_PROTOCOLS
            and assessment.primary_process == "general_distress"
        ):
            updates.setdefault("recommended_protocol", "supportive_reflection")
            updates.setdefault("alliance_priority", True)
    elif pref == "listen" and not signals["wants_skill"] and intensity < 7:
        if pid in STRUCTURED_PROTOCOLS:
            updates.setdefault("recommended_protocol", "supportive_reflection")
        updates.setdefault("alliance_priority", True)
    elif pref == "structured" and intensity >= 5 and pid == "supportive_reflection":
        if assessment.primary_process in ("rumination", "self_criticism"):
            updates.setdefault("recommended_protocol", "cbt_thought_record")
        elif assessment.primary_process in ("avoidance", "anhedonia"):
            updates.setdefault("recommended_protocol", "behavioral_activation")

    if updates:
        merged = {**assessment.model_dump(), **updates}
        merged["recommended_protocol"] = _normalize_protocol_id(str(merged["recommended_protocol"]))
        if merged.get("primary_process") not in TRANSDIAGNOSTIC_PROCESSES:
            merged["primary_process"] = assessment.primary_process
        tag = merged.get("rationale_internal") or ""
        if "balance" not in tag:
            merged["rationale_internal"] = (tag + "|balance").strip("|")
        return WellbeingTurnAssessment.model_validate(merged)
    return assessment


def _build_classifier_prompt(user_message: str, thread: dict[str, Any] | None) -> str:
    catalog = json.dumps(PROTOCOL_CATALOG, indent=2, ensure_ascii=False)
    return f"""You are a clinical triage assistant for a NON-CLINICAL emotional support product (Rimumu).
Select ONE recommended_protocol and classify the user's state. Do not diagnose disorders.

Balanced stance (important):
- Default is therapeutic alliance (supportive_reflection) when distress is moderate and the user needs space.
- Use structured modules (CBT/ACT/BA/MI/IPT/PM+) when a clear transdiagnostic process appears AND intensity allows (typically 5+).
- support_preference=listen → alliance-first unless user asks for a tool or intensity requires stabilization.
- support_preference=structured → offer one skill when process is clear; still reflect first in your reasoning.
- support_preference=mixed → weigh user language: "just listen" vs "what can I do" vs exploratory sharing.
- Do not alternate every turn between breathing and worksheets — variety and fit matter.

Rules:
- safety_escalation ONLY for self-harm, suicide, harm to others, abuse in danger, psychosis, medical emergency.
- distress_tolerance ONLY if needs_body_stabilization is true (panic, dissociation, urge to self-harm without plan, overwhelming physiological arousal).
- Do NOT choose distress_tolerance for ordinary stress, worry, sadness, or sleep issues unless intensity >= 8 AND physiological panic cues.
- If alliance_priority or support_preference is listen, prefer supportive_reflection unless safety requires escalation.
- Avoid repeating the same body skill: check skills_used; do not recommend paced_breathing or 5-4-3-2-1 if already used this session unless intensity >= 9.
- Match protocol to primary_process:
  * rumination / self_criticism → cbt_thought_record or act
  * avoidance/anhedonia → behavioral_activation or act
  * hyperarousal (true panic) → distress_tolerance or emotion_regulation
  * interpersonal → interpersonal_therapy
  * ambivalence/habits → motivational_interviewing
  * problem_overload → problem_management
  * decision_conflict → decision_support
  * grief_meaning → supportive_reflection or act
- intensity 0-10: estimate from language (not only intake mood).

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
    if re.search(r"\b(partner|girlfriend|boyfriend|mom|dad|friend|colleague|text them|relationship)\b", low):
        scores["interpersonal_therapy"] += 2.5
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
    return WellbeingTurnAssessment(
        intensity_0_10=min(10, max(0, intensity)),
        primary_process=process,
        recommended_protocol=best,
        session_phase="rapport"
        if (pref == "listen" or intensity <= 4) and best == "supportive_reflection"
        else "intervention",
        alliance_priority=pref == "listen" or (best == "supportive_reflection" and intensity <= 5),
        needs_body_stabilization=needs_body,
        formulation_note="",
        rationale_internal="scoring_fallback",
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
    if pid in STRUCTURED_PROTOCOLS:
        session["technique_turn_streak"] = int(session.get("technique_turn_streak") or 0) + 1
    elif pid == "supportive_reflection":
        session["technique_turn_streak"] = 0
    _sync_thread_sessions(thread, session)
