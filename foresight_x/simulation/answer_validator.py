"""Validate scoring clarify and comparative elicitation answers."""

from __future__ import annotations

import json

VALID_LEVELS = frozenset({"low", "medium", "high"})
IGNORE_LEVEL_ANSWERS = frozenset({
    "not sure",
    "unknown",
    "unsure",
    "idk",
    "don't know",
    "dont know",
    "n/a",
})


def normalize_level_answer(raw: str) -> str | None:
    t = raw.strip().lower()
    if t in VALID_LEVELS:
        return t
    if t in IGNORE_LEVEL_ANSWERS:
        return None
    return None


def is_comparative_question_id(qid: str) -> bool:
    return qid.startswith("cmp:") and qid.endswith(":rank")


def parse_comparative_rank(raw: str | list[str]) -> list[str] | None:
    if isinstance(raw, list):
        ids = [str(x).strip() for x in raw if str(x).strip()]
        return ids if ids else None
    text = raw.strip()
    if not text:
        return None
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                ids = [str(x).strip() for x in parsed if str(x).strip()]
                return ids if ids else None
        except json.JSONDecodeError:
            return None
    # comma-separated fallback
    ids = [p.strip() for p in text.split(",") if p.strip()]
    return ids if ids else None


def validate_scoring_clarification(
    raw: dict[str, str] | None,
) -> tuple[dict[str, str], list[str]]:
    """Return (valid level answers, error messages for invalid keys)."""
    if not raw:
        return {}, []
    valid: dict[str, str] = {}
    errors: list[str] = []
    for qid, ans in raw.items():
        if is_comparative_question_id(qid):
            continue
        lv = normalize_level_answer(str(ans))
        if lv is None:
            if str(ans).strip().lower() not in IGNORE_LEVEL_ANSWERS:
                errors.append(f"invalid_answer:{qid}")
            continue
        valid[qid] = lv
    return valid, errors


def validate_comparative_answers(
    raw: dict[str, list[str] | str] | None,
    *,
    expected_option_ids: set[str] | None = None,
) -> tuple[dict[str, list[str]], list[str]]:
    """Validate comparative rank payloads (cmp:{feature}:rank → ordered option ids)."""
    if not raw:
        return {}, []
    valid: dict[str, list[str]] = {}
    errors: list[str] = []
    for qid, ans in raw.items():
        if not is_comparative_question_id(qid):
            errors.append(f"invalid_comparative_id:{qid}")
            continue
        rank = parse_comparative_rank(ans)  # type: ignore[arg-type]
        if not rank:
            errors.append(f"invalid_comparative_rank:{qid}")
            continue
        if expected_option_ids is not None:
            seen: set[str] = set()
            for oid in rank:
                if oid not in expected_option_ids:
                    errors.append(f"unknown_option:{qid}:{oid}")
                if oid in seen:
                    errors.append(f"duplicate_option:{qid}:{oid}")
                seen.add(oid)
            if len(rank) != len(expected_option_ids):
                errors.append(f"incomplete_rank:{qid}")
            elif seen != expected_option_ids:
                errors.append(f"incomplete_rank:{qid}")
        valid[qid] = rank
    return valid, errors
