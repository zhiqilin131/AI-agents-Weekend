"""Evidence-informed wellbeing protocol guides — CBT, DBT, ACT, BA, MI, IPT, PM+."""

from __future__ import annotations

from typing import Any, Final

WellbeingProtocolId = str

PROTOCOL_IDS: Final[tuple[str, ...]] = (
    "safety_escalation",
    "distress_tolerance",
    "emotion_regulation",
    "cbt_thought_record",
    "act",
    "behavioral_activation",
    "motivational_interviewing",
    "interpersonal_therapy",
    "problem_management",
    "decision_support",
    "supportive_reflection",
)

# For LLM triage catalog (theory → when to use)
PROTOCOL_CATALOG: list[dict[str, str]] = [
    {
        "id": "supportive_reflection",
        "theory": "Humanistic / Rogerian alliance",
        "use_when": "Default listening; moderate distress; user wants to be heard; grief meaning-making without techniques",
    },
    {
        "id": "cbt_thought_record",
        "theory": "CBT cognitive model",
        "use_when": "Rumination, catastrophizing, self-criticism, identifiable hot thought tied to a situation",
    },
    {
        "id": "act",
        "theory": "Acceptance and Commitment Therapy",
        "use_when": "Avoidance of feelings, values conflict, fusion with thoughts, need willingness + values-based action",
    },
    {
        "id": "behavioral_activation",
        "theory": "Behavioral activation (Lewinsohn/Martell)",
        "use_when": "Low mood, anhedonia, withdrawal, can't get started, avoidance of activities",
    },
    {
        "id": "emotion_regulation",
        "theory": "DBT emotion regulation",
        "use_when": "Moderate-high emotion (6-8) without full panic; mood-dependent urges; PLEASE skills",
    },
    {
        "id": "distress_tolerance",
        "theory": "DBT distress tolerance",
        "use_when": "ONLY panic-level arousal (8-10), dissociation, impulse surge — not ordinary stress",
    },
    {
        "id": "motivational_interviewing",
        "theory": "Motivational Interviewing (Miller & Rollnick)",
        "use_when": "Ambivalence about change, habits, substance concerns, sustain vs change talk",
    },
    {
        "id": "interpersonal_therapy",
        "theory": "IPT-informed communication",
        "use_when": "Relationship conflict, role disputes, grief/loss in relationships, message drafting",
    },
    {
        "id": "problem_management",
        "theory": "WHO Problem Management Plus",
        "use_when": "Multiple practical problems; need structured problem-solving on ONE issue",
    },
    {
        "id": "decision_support",
        "theory": "Decision science + values",
        "use_when": "Explicit decision between options when emotion is manageable (<7/10)",
    },
    {
        "id": "safety_escalation",
        "theory": "Crisis protocol",
        "use_when": "Self-harm, suicide, violence, psychosis, medical emergency only",
    },
]

_CBT_THOUGHT_RECORD = """\
CBT-informed thought record (Beck cognitive model) — ONE column per turn:
1. Situation (facts only)
2. Automatic thought (hot thought)
3. Emotion + 0–10 intensity
4. Evidence for / against (facts, not mind-reading)
5. Balanced thought (realistic, compassionate)
6. Re-rate emotion; one behavioral experiment if relevant
Do not label the user with disorder names. Ask permission before deeper analysis."""

_ACT = """\
ACT (Acceptance & Commitment Therapy) — psychological flexibility, ONE move per turn:
- Validate willingness is hard
- Defusion: treat the thought as mental chatter, not a command
- Values: what matters here (1 question)?
- Committed action: one tiny step aligned with values (not mood-dependent)
Avoid arguing whether the thought is "true" — focus on workability and choice."""

_EMOTION_REGULATION = """\
DBT emotion regulation (NOT full distress tolerance):
- Name the emotion precisely (anxiety vs shame vs anger)
- Check PLEASE: Physical illness, Eating, Avoid mood-altering substances, Sleep, Exercise
- Opposite Action when emotion-driven behavior doesn't fit facts (one example)
- Problem-solving only if emotion fits facts and situation is solvable
Do NOT default to paced breathing — use only if user requests or panic is present."""

_DISTRESS_TOLERANCE = """\
DBT distress tolerance — ONLY when arousal is panic-level (8–10) or dissociation:
1. Validate + safety check
2. Pick ONE skill NOT used this session:
   - TIPP: Temperature, Intense exercise, Paced breathing, Progressive relaxation
   - 5-4-3-2-1 sensory grounding
   - Urge surfing, 10-minute delay
3. When intensity drops ~2 points, transition to reflection or CBT/ACT
If session already used paced breathing or 5-4-3-2-1, choose a DIFFERENT skill."""

_BEHAVIORAL_ACTIVATION = """\
Behavioral activation — depression/avoidance cycle:
1. Energy 0–10
2. Classify target: mastery, pleasure, connection, or routine
3. Offer 2 / 5 / 10 minute versions — user picks smallest doable
4. Optional: schedule; affirm effort not outcome"""

_MOTIVATIONAL_INTERVIEWING = """\
Motivational Interviewing (OARS + change talk):
- Open question, Affirmation, Reflect (simple + complex), Summarize ambivalence
- Elicit change talk: importance, confidence, small step
- Roll with resistance — no lecturing"""

_PROBLEM_MANAGEMENT = """\
WHO PM+ problem management:
1. Optional 30s settle (NOT required breathing)
2. ONE solvable problem (circle of control)
3. Brainstorm → choose action (when/where)
4. Social support + maintenance plan"""

_INTERPERSONAL_THERAPY = """\
IPT-informed interpersonal support:
- Clarify interpersonal problem area (role dispute, transition, grief, isolation)
- Feeling + need in one sentence (I-statement)
- Draft message or boundary script — user edits
- Timing: not when flooded; optional 24h pause"""

_DECISION_SUPPORT = """\
Values-aware decision support:
- If intensity ≥7, stabilize alliance first — defer full decision matrix
- Options, trade-offs, values, smallest safe next step
- Strength of recommendation (moderate/weak) — no overclaiming"""

_SUPPORTIVE_REFLECTION = """\
Humanistic / alliance-centered (default when listening is enough):
1. Accurate empathy about the USER (you/your; borrow key emotion words — do not parrot their line)
2. Normalization without minimizing
3. ONE perspective question OR gentle summary — NO body technique unless user asks
4. Permission before going deeper
Not every turn needs a skill — presence is the intervention."""

_SAFETY_ESCALATION = """\
SAFETY ESCALATION — stop coaching:
- Direct, calm; ask immediate danger and self/other harm
- Emergency services; U.S. 988
- Trusted person nearby
Do not continue CBT/ACT/BA until safety addressed."""

_TRAUMA_INFORMED_GLOBAL = """\
Trauma-informed (all turns):
- User control; no pressure to disclose; no graphic detail requests
- Collaborative language; ask permission
- No toxic positivity or diagnosis"""

_ALLIANCE_RESPONSE_SHAPE = """\
Response shape (professional support, plain language):
1. Accurate reflection about the USER in second person (you/your), not first-person echo of their sentence
2. Brief normalization or affirmation of effort (one sentence)
3. One-sentence psychoeducation: why this approach fits (no jargon dump)
4. ONE collaborative intervention step (ask consent if technique-based)
5. ONE question
If alliance_priority or support_preference=listen: steps 3–4 may be only reflection + question — no body skills.
Rimumu uses I/me only for the companion role; never speak as if the user's life story is yours. Not a therapist; no diagnosis."""

PROTOCOL_PROMPTS: dict[str, str] = {
    "safety_escalation": _SAFETY_ESCALATION,
    "distress_tolerance": _DISTRESS_TOLERANCE,
    "emotion_regulation": _EMOTION_REGULATION,
    "cbt_thought_record": _CBT_THOUGHT_RECORD,
    "act": _ACT,
    "behavioral_activation": _BEHAVIORAL_ACTIVATION,
    "motivational_interviewing": _MOTIVATIONAL_INTERVIEWING,
    "interpersonal_therapy": _INTERPERSONAL_THERAPY,
    "relationship_script": _INTERPERSONAL_THERAPY,
    "problem_management": _PROBLEM_MANAGEMENT,
    "decision_support": _DECISION_SUPPORT,
    "supportive_reflection": _SUPPORTIVE_REFLECTION,
}


def build_protocol_prompt_block(
    protocol_id: str,
    *,
    assessment: Any | None = None,
    thread: dict[str, Any] | None = None,
) -> str:
    pid = (protocol_id or "supportive_reflection").strip().lower()
    if pid == "relationship_script":
        pid = "interpersonal_therapy"
    body = PROTOCOL_PROMPTS.get(pid, _SUPPORTIVE_REFLECTION)
    lines = [f"--- Active wellbeing protocol: {pid} ---", body, _TRAUMA_INFORMED_GLOBAL, _ALLIANCE_RESPONSE_SHAPE]

    if assessment is not None:
        if hasattr(assessment, "model_dump"):
            ad = assessment.model_dump(mode="json")
        elif isinstance(assessment, dict):
            ad = assessment
        else:
            ad = {}
        lines.append(
            "--- Clinical triage (internal) ---\n"
            f"Intensity: {ad.get('intensity_0_10')}/10 | Process: {ad.get('primary_process')} | "
            f"Phase: {ad.get('session_phase')} | Body stabilization: {ad.get('needs_body_stabilization')}\n"
            f"Alliance-first: {ad.get('alliance_priority')}\n"
            f"Note: { (ad.get('formulation_note') or '')[:200] }"
        )

    if thread:
        from foresight_x.slime.therapy_session import get_therapy_session

        s = get_therapy_session(thread)
        skills = s.get("skills_used") or []
        if skills:
            lines.append(
                "--- Session skills already used (do NOT repeat unless intensity ≥9 or user asks) ---\n"
                + ", ".join(str(x) for x in skills[-8:])
            )
        pref = s.get("support_preference")
        if pref:
            lines.append(f"--- User support preference for this course: {pref} ---")

    return "\n".join(lines) + "\n"
