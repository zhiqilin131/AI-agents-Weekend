"""Generate structured therapy session reports (non-diagnostic, support-oriented)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.slime.therapy_session import get_therapy_session
from foresight_x.structured_predict import structured_predict


class TherapyActionSuggestion(BaseModel):
    title: str = Field(max_length=200)
    rationale: str = Field(max_length=500)
    calendar_hint: str = Field(default="", max_length=200)


class TherapyReportLLMOutput(BaseModel):
    executive_summary: str = Field(max_length=1200)
    session_summary: str = Field(max_length=2000)
    themes_observed: list[str] = Field(default_factory=list, max_length=8)
    strengths_noticed: list[str] = Field(default_factory=list, max_length=6)
    reflective_prompts: list[str] = Field(default_factory=list, max_length=5)
    suggested_actions: list[TherapyActionSuggestion] = Field(default_factory=list, max_length=6)
    safety_note: str = Field(
        default="This is emotional support, not medical advice or a diagnosis. "
        "Reach out to a qualified professional or crisis line if you need clinical care."
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _conversation_excerpt(thread: dict[str, Any], *, max_turns: int = 24) -> str:
    lines: list[str] = []
    for m in (thread.get("messages") or [])[-max_turns:]:
        if not isinstance(m, dict):
            continue
        md = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
        if md.get("artifact_type") in ("therapy_report", "decision_report"):
            continue
        role = str(m.get("role") or "")
        if role not in ("user", "assistant"):
            continue
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:800]}")
    return "\n".join(lines)


def generate_therapy_report(thread: dict[str, Any], *, llm: Any) -> dict[str, Any]:
    """Build a durable therapy report dict from thread + session state."""
    session = get_therapy_session(thread)
    transcript = _conversation_excerpt(thread)
    intake_block = json.dumps(
        {
            "mood_score": session.get("mood_score"),
            "primary_concern": session.get("primary_concern"),
            "session_goal": session.get("session_goal"),
            "optional_note": session.get("optional_note"),
        },
        ensure_ascii=False,
    )

    protocols_used = session.get("sessions_protocols_used") or []
    clinical = session.get("last_clinical") if isinstance(session.get("last_clinical"), dict) else {}
    prompt = f"""You are Rimumu, a gentle wellbeing support companion (NOT a clinician).

Write a SOAP-style session summary report (plain language, not clinical jargon).
Sections to cover in session_summary (use short headings in prose):
- Subjective: what the user reported (their words)
- Objective: observable patterns from the chat (tone, themes — no diagnosis)
- Assessment: transdiagnostic formulation (processes like rumination, avoidance — not disorder labels)
- Plan: 1–3 small self-directed next steps

Rules:
- Never diagnose, label disorders, or claim clinical authority.
- Use warm, validating, autonomy-first language (CBT/ACT/BA-informed but plain).
- Reference only what appears in the transcript and intake — do not invent facts.
- Name protocols/skills used when evident (e.g. thought record, behavioral activation) without sounding like a manual.
- suggested_actions must be small, concrete, self-directed steps (not medical orders).
- calendar_hint: short natural-language scheduling phrase (e.g. "Tomorrow at 7pm for 30 minutes — gentle walk") for every suggested_action; required when the step is time-based.

--- Intake ---
{intake_block}

--- Protocols used this thread ---
{json.dumps(protocols_used, ensure_ascii=False)}

--- Last clinical triage (internal) ---
{json.dumps(clinical, ensure_ascii=False)}

--- Transcript ---
{transcript or "(No messages yet — write a brief supportive closure based on intake only.)"}
"""

    try:
        out = structured_predict(llm, TherapyReportLLMOutput, prompt)
        parsed = out.model_dump(mode="json") if hasattr(out, "model_dump") else TherapyReportLLMOutput.model_validate(out).model_dump()
    except Exception:
        parsed = TherapyReportLLMOutput(
            executive_summary="Thank you for showing up today. You named what matters and took time to reflect.",
            session_summary="We focused on what you brought in and looked for one small next step.",
            themes_observed=[str(session.get("primary_concern") or "General wellbeing")[:80]],
            strengths_noticed=["You reached out and stayed engaged"],
            reflective_prompts=["What felt even slightly easier by the end?"],
            suggested_actions=[
                TherapyActionSuggestion(
                    title="One small rest break",
                    rationale="Short pauses can lower overwhelm.",
                    calendar_hint="",
                )
            ],
        ).model_dump(mode="json")

    report_id = str(uuid.uuid4())
    return {
        "id": report_id,
        "generated_at": _utc_now(),
        "disclaimer": parsed.get("safety_note") or TherapyReportLLMOutput.model_fields["safety_note"].default,
        **parsed,
    }
