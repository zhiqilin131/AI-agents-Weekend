"""Extract calendar draft fields from voice transcripts (LLM + regex fallback)."""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from foresight_x.config import Settings
from foresight_x.orchestration.llm_factory import build_openai_llm
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)


class CalendarDraft(BaseModel):
    title: str = Field(default="Planning block", max_length=200)
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    date_hint: str | None = Field(default=None, max_length=120)
    time_hint: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    timezone: str | None = Field(default=None, max_length=80)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class _LLMParsed(BaseModel):
    title: str = "Planning block"
    duration_minutes: int | None = None
    date_hint: str | None = None
    time_hint: str | None = None
    description: str | None = None
    confidence: float = 0.7


_PARSE_PROMPT = """Extract a calendar event draft from the user's voice command.

Transcript:
{transcript}

Return JSON-matching fields:
- title: short event name (e.g. "Planning block", "Gym", "Review checkpoint")
- duration_minutes: integer minutes if said (e.g. 30 for "30 minute"), else null
- date_hint: phrase like "tomorrow", "Saturday", "next Friday", or null
- time_hint: phrase like "9", "9:00", "morning", "afternoon", "evening", or null
- description: optional extra detail or null
- confidence: 0-1 how sure you are

Defaults if omitted: duration null, date_hint null only if truly absent.
"""


def _regex_fallback(transcript: str) -> CalendarDraft:
    t = transcript.strip()
    low = t.lower()
    dur: int | None = None
    m = re.search(r"\b(\d{1,3})\s*[- ]?minute", low)
    if m:
        dur = max(5, min(int(m.group(1)), 480))
    m2 = re.search(r"\b(\d{1,2})\s*(?:hour|hr)\b", low)
    if m2 and dur is None:
        dur = max(5, min(int(m2.group(1)) * 60, 480))

    date_hint: str | None = None
    for phrase in (
        "next friday",
        "next monday",
        "next tuesday",
        "next wednesday",
        "next thursday",
        "next saturday",
        "next sunday",
        "tomorrow",
        "today",
    ):
        if phrase in low:
            date_hint = phrase
            break
    if date_hint is None:
        for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
            if day in low:
                date_hint = day
                break

    time_hint: str | None = None
    if "morning" in low:
        time_hint = "morning"
    elif "afternoon" in low:
        time_hint = "afternoon"
    elif "evening" in low:
        time_hint = "evening"
    else:
        mt = re.search(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", low)
        if mt:
            time_hint = mt.group(0).replace("at ", "").strip()

    title = "Planning block"
    if "gym" in low:
        title = "Gym"
    elif "review" in low or "checkpoint" in low:
        title = "Review checkpoint"
    elif "planning" in low:
        title = "Planning block"
    elif mtitle := re.search(r"(?:add|put|schedule)\s+(?:a\s+)?(.+?)\s+(?:on|for|at)\b", low):
        chunk = mtitle.group(1).strip()
        if chunk and len(chunk) < 80:
            title = chunk.title()

    if dur is None:
        lt = title.lower()
        if any(x in lt for x in ("review", "checkpoint", "planning")):
            dur = 30
        elif "gym" in lt:
            dur = 60
        else:
            dur = 30

    return CalendarDraft(
        title=title[:200],
        duration_minutes=dur,
        date_hint=date_hint,
        time_hint=time_hint,
        description=None,
        timezone=None,
        confidence=0.45,
    )


def parse_calendar_command(
    transcript: str,
    *,
    settings: Settings | None = None,
    prefer_regex: bool = False,
) -> CalendarDraft:
    t = (transcript or "").strip()
    if not t:
        return CalendarDraft(confidence=0.1)

    s = settings
    if prefer_regex or not s or not (s.openai_api_key or "").strip():
        return _regex_fallback(t)

    prompt = _PARSE_PROMPT.format(transcript=t[:3000])
    llm = build_openai_llm(s, temperature=0.05)
    try:
        raw = structured_predict(llm, _LLMParsed, prompt)
    except Exception as e:
        _log.warning("calendar parse LLM failed: %s", e)
        return _regex_fallback(t)

    dur = raw.duration_minutes
    if dur is not None:
        dur = max(5, min(int(dur), 480))
    return CalendarDraft(
        title=(raw.title or "Planning block").strip()[:200] or "Planning block",
        duration_minutes=dur,
        date_hint=(raw.date_hint or "").strip()[:120] or None,
        time_hint=(raw.time_hint or "").strip()[:80] or None,
        description=(raw.description or "").strip()[:500] or None,
        timezone=None,
        confidence=float(raw.confidence or 0.6),
    )


def merge_calendar_args_with_transcript(
    args: dict[str, Any],
    transcript: str,
    *,
    settings: Settings | None = None,
) -> CalendarDraft:
    """Router args win when present; parser fills gaps from transcript."""
    parsed = parse_calendar_command(
        transcript,
        settings=settings,
        prefer_regex=bool(args.get("_fast_parse") or args.get("fast_parse")),
    )
    title = str(args.get("title") or "").strip()
    if not title:
        title = parsed.title
    dur_raw = args.get("duration_minutes")
    duration: int | None = parsed.duration_minutes
    if dur_raw is not None:
        try:
            duration = max(5, min(int(dur_raw), 480))
        except (TypeError, ValueError):
            pass
    dh = args.get("date_hint")
    date_hint = str(dh).strip()[:120] if dh else parsed.date_hint
    th = args.get("time_hint")
    time_hint = str(th).strip()[:80] if th else parsed.time_hint
    desc = args.get("description")
    description = str(desc).strip()[:500] if desc else parsed.description
    tz = args.get("timezone")
    timezone = str(tz).strip()[:80] if tz else parsed.timezone
    return CalendarDraft(
        title=title[:200],
        duration_minutes=duration,
        date_hint=date_hint,
        time_hint=time_hint,
        description=description,
        timezone=timezone,
        confidence=max(float(parsed.confidence), 0.4),
    )
