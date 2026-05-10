"""Stage 1: distill signals. Stage 2: narrative diary from signals only."""

from __future__ import annotations

import json
import logging
from typing import Any

from foresight_x.diary.diary_quality import sanitize_diary_draft, validate_diary_quality
from foresight_x.diary.prompt import DIARY_DISTILL_RULES, DIARY_NARRATIVE_RULES
from foresight_x.diary.schemas import (
    CleanDiaryBundleMeta,
    DiaryLLMPlan,
    DiarySignalBundle,
    DiarySourceBundle,
)
from foresight_x.structured_predict import structured_predict

_log = logging.getLogger(__name__)


def _sample_lines(previews: list[str], max_items: int, max_chars: int) -> list[str]:
    out: list[str] = []
    if len(previews) <= max_items:
        chosen = previews
    else:
        step = (len(previews) - 1) / max(1, max_items - 1)
        chosen = [previews[min(len(previews) - 1, round(i * step))] for i in range(max_items)]
    for p in chosen:
        t = (p or "").strip()
        if not t:
            continue
        out.append(t[:max_chars])
    return out


def _distill_payload(cleaned: DiarySourceBundle, meta: CleanDiaryBundleMeta) -> dict[str, Any]:
    return {
        "date": cleaned.date,
        "timezone": cleaned.timezone,
        "cleaning": {
            "noise_filtered": meta.noise_filtered,
            "duplicates_collapsed": meta.duplicate_collapsed,
            "offensive_redacted": meta.offensive_redacted,
        },
        "chat_lines": _sample_lines([m.preview for m in cleaned.chat_messages], 56, 260),
        "voice_lines": _sample_lines([v.preview for v in cleaned.voice_turns], 32, 260),
        "decisions": [d.preview[:400] for d in cleaned.decision_reports[:10]],
        "calendar": [f"{c.kind}:{c.title}" for c in cleaned.calendar_items[:12]],
        "memory_lines": _sample_lines([m.text_preview for m in cleaned.approved_memories], 28, 220),
        "imported_lines": _sample_lines([i.preview for i in cleaned.imported_context], 14, 220),
    }


def distill_daily_diary_signals(
    llm: Any,
    cleaned: DiarySourceBundle,
    meta: CleanDiaryBundleMeta,
) -> DiarySignalBundle:
    payload = _distill_payload(cleaned, meta)
    prompt = (
        f"{DIARY_DISTILL_RULES}\nOUTPUT_JSON_SCHEMA: DiarySignalBundle fields.\n\n"
        f"DATA_JSON:\n{json.dumps(payload, ensure_ascii=False)}\n"
    )
    return structured_predict(llm, DiarySignalBundle, prompt)


def write_diary_narrative(
    llm: Any,
    signals: DiarySignalBundle,
    *,
    stricter: bool = False,
    persona_context: str | None = None,
) -> DiaryLLMPlan:
    extra = ""
    if persona_context and persona_context.strip():
        extra = f"\nOPTIONAL_PERSONA_CONTEXT (do not quote verbatim; infer tone only):\n{persona_context.strip()[:1200]}\n"
    strict = (
        "\nSTRICT MODE: Must be 180–280 words, exactly 2–4 paragraphs, no log phrases, human title.\n"
        if stricter
        else ""
    )
    prompt = (
        f"{DIARY_NARRATIVE_RULES}{strict}{extra}\n"
        "Respond with JSON only: title, summary, highlights (0–5 short noun phrases), themes (2–5), tone, action_items.\n\n"
        f"SIGNALS_JSON:\n{signals.model_dump_json()}\n"
    )
    plan = structured_predict(llm, DiaryLLMPlan, prompt)
    return sanitize_diary_draft(plan)


def run_two_stage_diary_llm(
    llm: Any,
    cleaned: DiarySourceBundle,
    meta: CleanDiaryBundleMeta,
    *,
    persona_context: str | None = None,
) -> DiaryLLMPlan | None:
    """Distill then narrate; retry narrative once if quality check fails."""
    try:
        signals = distill_daily_diary_signals(llm, cleaned, meta)
        extra_noise = [
            f"cleaning_dupes:{meta.duplicate_collapsed}",
            f"cleaning_noise:{meta.noise_filtered}",
        ]
        raw = signals.model_dump()
        raw["discarded_noise"] = (raw.get("discarded_noise") or []) + extra_noise
        signals = DiarySignalBundle.model_validate(raw)
        plan = write_diary_narrative(llm, signals, stricter=False, persona_context=persona_context)
        q = validate_diary_quality(plan, strict_title=True)
        if not q.ok:
            _log.info("diary narrative quality retry: %s", q.issues)
            plan = write_diary_narrative(llm, signals, stricter=True, persona_context=persona_context)
            plan = sanitize_diary_draft(plan)
            q = validate_diary_quality(plan, strict_title=False)
            if not q.ok:
                _log.info("diary narrative quality still failing: %s", q.issues)
                plan = sanitize_diary_draft(plan)
        return plan
    except Exception as e:
        _log.info("diary two-stage llm failed: %s", e)
        return None
