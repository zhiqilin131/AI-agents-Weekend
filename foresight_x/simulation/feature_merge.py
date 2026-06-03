"""Priority merge: user > tags > profile > evidence > rule > keyword > unknown."""

from __future__ import annotations

from dataclasses import dataclass

from foresight_x.schemas import Option, OptionTradeoffTags
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    PROXY_FEATURE_KEYS,
    FeatureLevel,
    FeatureProvenance,
    FeatureSourceType,
    FeatureStatus,
)

TAGGABLE_KEYS = (
    "time_cost_level",
    "money_cost_level",
    "stress_load_level",
    "workload_level",
    "upside_potential_level",
    "downside_severity_level",
    "goal_alignment_level",
)


@dataclass
class ResolvedFeature:
    level: FeatureLevel
    status: FeatureStatus
    provenance: FeatureProvenance | None


def _prov(
    feature_key: str,
    value: FeatureLevel,
    source_type: FeatureSourceType,
    source_ref: str | None,
    confidence: float,
    note: str,
) -> FeatureProvenance:
    return FeatureProvenance(
        feature_key=feature_key,
        value=value,
        source_type=source_type,
        source_ref=source_ref,
        confidence=confidence,
        note=note,
    )


def level_from_clarify_answer(raw: str) -> FeatureLevel | None:
    return _level_from_clarify_answer(raw)


def _level_from_clarify_answer(raw: str) -> FeatureLevel | None:
    t = raw.strip().lower()
    if t in ("low", "medium", "high"):
        return t  # type: ignore[return-value]
    if t in ("not sure", "unknown", "unsure", "idk", "don't know", "dont know"):
        return None
    return None


def resolve_feature(
    feature_key: str,
    *,
    option: Option,
    scoring_overrides: dict[str, FeatureLevel] | None = None,
    tag_level: FeatureLevel | None = None,
    tag_confidence: float = 0.5,
    rule_level: FeatureLevel | None = None,
    rule_confidence: float = 0.7,
    keyword_level: FeatureLevel | None = None,
    keyword_confidence: float = 0.55,
    profile_level: FeatureLevel | None = None,
    profile_confidence: float = 0.7,
    evidence_level: FeatureLevel | None = None,
    evidence_confidence: float = 0.65,
    tag_quality_passes: bool = True,
    profile_status: FeatureStatus | None = None,
) -> ResolvedFeature:
    """Resolve one feature with auditable priority."""
    oid = option.option_id
    overrides = scoring_overrides or {}

    if feature_key in overrides and overrides[feature_key] != "unknown":
        lv = overrides[feature_key]
        return ResolvedFeature(
            level=lv,
            status="known",
            provenance=_prov(
                feature_key,
                lv,
                "scoring_clarification",
                oid,
                0.95,
                "User answered targeted scoring clarify question.",
            ),
        )

    if tag_level and tag_level != "unknown":
        tags = option.tradeoff_tags
        conf = tags.tag_confidence if tags else tag_confidence
        src = tags.tag_source if tags else "template"
        if not tag_quality_passes:
            status = "candidate"
            conf = min(conf, 0.6)
        elif src == "user":
            status = "known"
        elif src == "llm_tagging":
            status = "known" if conf >= 0.75 else "candidate"
        else:
            status = "known" if conf >= 0.65 else "candidate"
        return ResolvedFeature(
            level=tag_level,
            status=status,
            provenance=_prov(
                feature_key,
                tag_level,
                "option_tags",
                f"{oid}.tradeoff_tags.{src}",
                conf,
                "Structured option tradeoff tag.",
            ),
        )

    if profile_level and profile_level != "unknown":
        return ResolvedFeature(
            level=profile_level,
            status=profile_status or "known",
            provenance=_prov(
                feature_key,
                profile_level,
                "profile_memory",
                "user_state.profile",
                profile_confidence,
                "Profile or structured goal achievement.",
            ),
        )

    if evidence_level and evidence_level != "unknown":
        return ResolvedFeature(
            level=evidence_level,
            status="known",
            provenance=_prov(
                feature_key,
                evidence_level,
                "world_evidence",
                "evidence.facts",
                evidence_confidence,
                "Grounded world evidence.",
            ),
        )

    if rule_level and rule_level != "unknown":
        conf = min(rule_confidence, 0.6)
        note = (
            "Proxy/structural rule derivation (candidate until tags or user confirm)."
            if feature_key in PROXY_FEATURE_KEYS
            else "Deterministic rule derivation (candidate until confirmed)."
        )
        return ResolvedFeature(
            level=rule_level,
            status="candidate",
            provenance=_prov(
                feature_key,
                rule_level,
                "rule",
                oid,
                conf,
                note,
            ),
        )

    if keyword_level and keyword_level != "unknown":
        return ResolvedFeature(
            level=keyword_level,
            status="candidate",
            provenance=_prov(
                feature_key,
                keyword_level,
                "option_text",
                oid,
                keyword_confidence,
                "Keyword signal in option text (needs confirmation for high-stakes).",
            ),
        )

    return ResolvedFeature(
        level="unknown",
        status="unknown",
        provenance=_prov(feature_key, "unknown", "rule", oid, 0.3, "No grounded signal; remains unknown."),
    )


def tag_level_for(option: Option, key: str) -> FeatureLevel | None:
    tags = option.tradeoff_tags
    if tags is None:
        return None
    val = getattr(tags, key, "unknown")
    return val if val != "unknown" else None


def default_tradeoff_tags_for_option(option: Option) -> OptionTradeoffTags:
    """Heuristic template tags from cost_of_reversal and option text (fallback)."""
    blob = f"{option.name} {option.description}".lower()
    rev = option.cost_of_reversal
    stress = "unknown"
    workload = "unknown"
    time_c = "unknown"
    money = "unknown"
    upside = "unknown"
    downside = "unknown"
    goal = "unknown"

    if rev == "low":
        downside = "low"
    elif rev == "high":
        downside = "high"

    if any(k in blob for k in ("growth", "upside", "promotion", "breakthrough")):
        upside = "high"
    if any(k in blob for k in ("free", "stipend", "raise", "bonus")):
        money = "low"
    if any(k in blob for k in ("expensive", "costly", "fee", "tuition", "pay cut")):
        money = "high"
    if any(k in blob for k in ("sprint", "urgent", "immediate", "48-hour", "deadline")):
        time_c = "high"
    if any(k in blob for k in ("extension", "delay", "more time", "wait")):
        time_c = "low"
    if any(k in blob for k in ("light", "manageable", "low stress", "gentle")):
        stress = "low"
        workload = "low"
    if any(k in blob for k in ("sprint", "intensive", "heavy", "overtime", "all-in")):
        stress = "high"
        workload = "high"
    if any(k in blob for k in ("risky", "irreversible", "downside", "fail")):
        downside = "high"

    return OptionTradeoffTags(
        time_cost_level=time_c,
        money_cost_level=money,
        stress_load_level=stress,
        workload_level=workload,
        upside_potential_level=upside,
        downside_severity_level=downside,
        goal_alignment_level=goal,
        tag_confidence=0.68,
        tag_source="template",
    )


def option_grounded_coverage(fv) -> float:
    """Grounded coverage for a single option feature vector."""
    statuses = getattr(fv, "field_status", {}) or {}
    known_slots = 0.0
    for key in CRITICAL_FEATURE_KEYS:
        st = statuses.get(key, "unknown")
        if st == "known":
            known_slots += 1
        elif st == "candidate":
            known_slots += 0.5
    return known_slots / max(1, len(CRITICAL_FEATURE_KEYS))


def ensure_option_tags(options: list[Option]) -> list[Option]:
    out: list[Option] = []
    for opt in options:
        if opt.tradeoff_tags is None:
            out.append(opt.model_copy(update={"tradeoff_tags": default_tradeoff_tags_for_option(opt)}))
        else:
            out.append(opt)
    return out


def parse_scoring_overrides_for_option(
    option_id: str,
    scoring_clarification: dict[str, str] | None,
) -> dict[str, FeatureLevel]:
    """Parse answers like ``opt_a:money_cost_level`` or global ``money_cost_level``."""
    if not scoring_clarification:
        return {}
    out: dict[str, FeatureLevel] = {}
    for qid, ans in scoring_clarification.items():
        lv = _level_from_clarify_answer(ans)
        if lv is None:
            continue
        if ":" in qid:
            oid, fkey = qid.split(":", 1)
            if oid.strip() == option_id and fkey.strip() in CRITICAL_FEATURE_KEYS:
                out[fkey.strip()] = lv
        elif qid.strip() in CRITICAL_FEATURE_KEYS:
            out[qid.strip()] = lv
    return out


def grounded_coverage(feature_vectors: list) -> float:
    if not feature_vectors:
        return 0.0
    total_slots = 0
    known_slots = 0
    for fv in feature_vectors:
        statuses = getattr(fv, "field_status", {}) or {}
        for key in CRITICAL_FEATURE_KEYS:
            total_slots += 1
            st = statuses.get(key, "unknown")
            if st == "known":
                known_slots += 1
            elif st == "candidate":
                known_slots += 0.5
    return known_slots / max(1, total_slots)
