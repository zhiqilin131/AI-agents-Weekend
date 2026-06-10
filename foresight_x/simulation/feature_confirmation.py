"""Apply scoring clarification answers and confirmed candidates to options."""

from __future__ import annotations

from foresight_x.schemas import Option, OptionTradeoffTags
from foresight_x.simulation.feature_registry import level_keys
from foresight_x.simulation.feature_merge import level_from_clarify_answer
from foresight_x.simulation.feature_schemas import FeatureCandidate, FeatureLevel

LEVEL_KEYS = level_keys()


def apply_scoring_clarification_to_options(
    options: list[Option],
    scoring_clarification: dict[str, str] | None,
) -> list[Option]:
    """Merge user scoring answers into option.tradeoff_tags as user-sourced known levels."""
    if not scoring_clarification:
        return options
    by_id = {o.option_id: o for o in options}
    updated: list[Option] = []
    for opt in options:
        tags = opt.tradeoff_tags or OptionTradeoffTags()
        payload = tags.model_dump()
        changed = False
        for qid, ans in scoring_clarification.items():
            lv = level_from_clarify_answer(ans)
            if lv is None:
                continue
            if ":" in qid:
                oid, fkey = qid.split(":", 1)
                if oid.strip() != opt.option_id:
                    continue
                key = fkey.strip()
            else:
                key = qid.strip()
            if key not in LEVEL_KEYS:
                continue
            payload[key] = lv
            changed = True
        if changed:
            payload["tag_source"] = "user"
            payload["tag_confidence"] = 0.95
            updated.append(opt.model_copy(update={"tradeoff_tags": OptionTradeoffTags.model_validate(payload)}))
        else:
            updated.append(opt)
    return updated


def apply_confirmed_candidates(
    options: list[Option],
    confirmed: list[dict[str, str]] | None,
) -> list[Option]:
    """confirmed items: {option_id, feature_key, level, confirmed: yes|no}"""
    if not confirmed:
        return options
    by_id = {o.option_id: o for o in options}
    patch: dict[str, dict[str, FeatureLevel]] = {}
    for row in confirmed:
        if str(row.get("confirmed", "")).lower() not in ("yes", "true", "1"):
            continue
        oid = str(row.get("option_id", "")).strip()
        fkey = str(row.get("feature_key", "")).strip()
        lv = str(row.get("level", "")).strip().lower()
        if oid and fkey in LEVEL_KEYS and lv in ("low", "medium", "high"):
            patch.setdefault(oid, {})[fkey] = lv  # type: ignore[assignment]
    out: list[Option] = []
    for opt in options:
        if opt.option_id not in patch:
            out.append(opt)
            continue
        tags = opt.tradeoff_tags or OptionTradeoffTags()
        payload = tags.model_dump()
        payload.update(patch[opt.option_id])
        payload["tag_source"] = "user"
        payload["tag_confidence"] = 0.9
        out.append(opt.model_copy(update={"tradeoff_tags": OptionTradeoffTags.model_validate(payload)}))
    return out


def candidates_from_confirmations(
    candidates: list[FeatureCandidate],
    confirmed: list[dict[str, str]] | None,
) -> list[FeatureCandidate]:
    if not confirmed:
        return candidates
    confirmed_yes = {
        (str(r.get("option_id")), str(r.get("feature_key")))
        for r in confirmed
        if str(r.get("confirmed", "")).lower() in ("yes", "true", "1")
    }
    return [c for c in candidates if (c.option_id, c.feature_key) not in confirmed_yes]
