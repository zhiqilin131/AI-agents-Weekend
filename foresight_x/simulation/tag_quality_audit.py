"""Tag quality audit: consistency checks before promoting tags to known."""

from __future__ import annotations

import re

from foresight_x.schemas import EvidenceBundle, Option, OptionTradeoffTags
from foresight_x.simulation.feature_schemas import TagQualityReport

_STRESS_HIGH = ("burnout", "overwhelm", "anxious", "stressful", "intense", "sprint", "all-in")
_STRESS_LOW = ("calm", "low stress", "manageable", "gentle", "light")
_WORKLOAD_HIGH = ("heavy", "overtime", "intensive", "all-nighter")
_MONEY_HIGH = ("expensive", "costly", "fee", "tuition", "pay cut")
_MONEY_LOW = ("free", "stipend", "scholarship", "raise", "bonus")

_TAGGABLE = (
    "time_cost_level",
    "money_cost_level",
    "stress_load_level",
    "workload_level",
    "upside_potential_level",
    "downside_severity_level",
    "goal_alignment_level",
)


def _blob(option: Option) -> str:
    return f"{option.name} {option.description} {' '.join(option.key_assumptions)}".lower()


def _tag_conflicts(option: Option, tags: OptionTradeoffTags) -> list[str]:
    blob = _blob(option)
    conflicts: list[str] = []

    if tags.stress_load_level == "low" and any(k in blob for k in _STRESS_HIGH):
        conflicts.append("stress_load_level=low conflicts with high-stress language in option text")
    if tags.stress_load_level == "high" and any(k in blob for k in _STRESS_LOW):
        conflicts.append("stress_load_level=high conflicts with low-stress language in option text")
    if tags.workload_level == "low" and any(k in blob for k in _WORKLOAD_HIGH):
        conflicts.append("workload_level=low conflicts with heavy-workload language")
    if tags.money_cost_level == "low" and any(k in blob for k in _MONEY_HIGH):
        conflicts.append("money_cost_level=low conflicts with high-cost language")
    if tags.money_cost_level == "high" and any(k in blob for k in _MONEY_LOW):
        conflicts.append("money_cost_level=high conflicts with low-cost language")
    return conflicts


def _evidence_support_count(option: Option, evidence: EvidenceBundle) -> int:
    opt_tokens = {w for w in re.findall(r"[a-zA-Z]{4,}", _blob(option))}
    if not opt_tokens:
        return 0
    hits = 0
    for item in evidence.facts + evidence.base_rates + evidence.recent_events:
        text = (item.text or "").strip().lower()
        if not text:
            continue
        sent_tokens = {w for w in re.findall(r"[a-zA-Z]{4,}", text)}
        if opt_tokens & sent_tokens:
            hits += 1
    return hits


def audit_option_tags(option: Option, evidence: EvidenceBundle) -> TagQualityReport:
    tags = option.tradeoff_tags
    if tags is None:
        return TagQualityReport(option_id=option.option_id, coverage_tagged=0.0, passes_quality_gate=False)

    tagged = sum(1 for k in _TAGGABLE if getattr(tags, k, "unknown") != "unknown")
    coverage = tagged / max(1, len(_TAGGABLE))
    conflicts = _tag_conflicts(option, tags)
    ev_support = _evidence_support_count(option, evidence)

    # llm_tagging needs higher bar; template passes if no text conflicts.
    src = tags.tag_source or "template"
    conf = tags.tag_confidence or 0.5
    if conflicts:
        passes = False
    elif src == "llm_tagging":
        passes = conf >= 0.75 or ev_support >= 1
    elif src == "user":
        passes = True
    else:
        passes = conf >= 0.65 and not conflicts

    return TagQualityReport(
        option_id=option.option_id,
        coverage_tagged=round(coverage, 3),
        text_conflicts=conflicts,
        evidence_support_count=ev_support,
        passes_quality_gate=passes,
    )


def audit_all_option_tags(options: list[Option], evidence: EvidenceBundle) -> list[TagQualityReport]:
    return [audit_option_tags(o, evidence) for o in options]
