"""Fix stale calendar years in recommendation text (LLMs sometimes emit old dates)."""

from __future__ import annotations

import re

from foresight_x.schemas import NextAction, Recommendation

# Parenthetical ISO dates: (2023-10-06)
_PAREN_DATE = re.compile(r"\((\d{4})-(\d{2})-(\d{2})\)")
# Standalone YYYY-MM-DD
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _anchor_year(anchor_now_iso: str) -> int:
    try:
        return int(str(anchor_now_iso)[:4])
    except (TypeError, ValueError):
        return 2026


def normalize_deadline_strings(text: str | None, anchor_now_iso: str) -> str | None:
    """Raise any year in ISO-like dates that is before the anchor year to the anchor year."""
    if not text or not str(text).strip():
        return text
    min_y = _anchor_year(anchor_now_iso)

    def fix_paren(m: re.Match[str]) -> str:
        y = int(m.group(1))
        if y < min_y:
            return f"({min_y}-{m.group(2)}-{m.group(3)})"
        return m.group(0)

    def fix_iso(m: re.Match[str]) -> str:
        y = int(m.group(1))
        if y < min_y:
            return f"{min_y}-{m.group(2)}-{m.group(3)}"
        return m.group(0)

    s = _PAREN_DATE.sub(fix_paren, text)
    s = _ISO_DATE.sub(fix_iso, s)
    return s


def normalize_recommendation_deadlines(rec: Recommendation, anchor_now_iso: str) -> Recommendation:
    """Apply date normalization to next_actions and lightly to reasoning (parenthetical dates)."""
    min_y = _anchor_year(anchor_now_iso)
    if min_y < 2000:
        return rec

    new_actions: list[NextAction] = []
    for a in rec.next_actions:
        d = normalize_deadline_strings(a.deadline, anchor_now_iso)
        act = normalize_deadline_strings(a.action, anchor_now_iso) or a.action
        new_actions.append(
            NextAction(
                action=act or "",
                deadline=d,
                artifacts=list(a.artifacts),
            )
        )
    reasoning = normalize_deadline_strings(rec.reasoning, anchor_now_iso) or rec.reasoning
    return rec.model_copy(
        update={
            "next_actions": new_actions,
            "reasoning": reasoning,
        }
    )
