"""Deterministic extraction of OptionFeatureVector from grounded inputs."""

from __future__ import annotations

import re

from foresight_x.schemas import EvidenceBundle, MemoryBundle, Option, Reversibility, TimePressure, UserState
from foresight_x.simulation.feature_merge import (
    ResolvedFeature,
    parse_scoring_overrides_for_option,
    resolve_feature,
    tag_level_for,
)
from foresight_x.simulation.goal_achievement import assess_structured_goal_alignment
from foresight_x.simulation.tag_quality_audit import audit_option_tags
from foresight_x.simulation.feature_schemas import (
    CRITICAL_FEATURE_KEYS,
    FeatureLevel,
    FeatureProvenance,
    OptionFeatureVector,
)

_TIME_HIGH = (
    "deadline", "urgent", "immediate", "asap", "rush", "sprint", "48-hour", "48 hour", "this week", "tonight",
)
_TIME_LOW = ("delay", "wait", "pause", "extension", "more time", "later", "defer")
_MONEY_HIGH = ("expensive", "costly", "tuition", "loan", "salary cut", "pay cut", "invest", "fee")
_MONEY_LOW = ("free", "no cost", "stipend", "scholarship", "raise", "bonus", "paid")
_STRESS_HIGH = ("burnout", "overwhelm", "anxious", "stressful", "intense")
_STRESS_LOW = ("calm", "low stress", "manageable", "gentle", "light")
_WORKLOAD_HIGH = ("heavy", "overtime", "double", "sprint", "all-nighter", "intensive", "full-time load")
_WORKLOAD_LOW = ("light", "minimal effort", "low effort", "part-time", "easy")
_DOWNSIDE_HIGH = ("irreversible", "fail", "lose", "risky", "worst case", "downside", "tail risk")
_DOWNSIDE_LOW = ("safe", "protected", "downside limited", "low risk")
_UPSIDE_HIGH = ("upside", "growth", "promotion", "breakthrough", "high reward", "transform")
_UPSIDE_LOW = ("incremental", "modest", "marginal", "status quo")
_CONFLICT = ("conflict", "violat", "against", "cannot", "forbidden", "incompatible", "need income", "must")


def _keyword_level(blob: str, high_kw: tuple[str, ...], low_kw: tuple[str, ...]) -> FeatureLevel | None:
    text = blob.lower()
    hi = sum(1 for k in high_kw if k in text)
    lo = sum(1 for k in low_kw if k in text)
    if hi > lo and hi > 0:
        return "high"
    if lo > hi and lo > 0:
        return "low"
    if hi == lo and hi > 0:
        return "medium"
    return None


def _reversibility_from_cost(cost: str) -> FeatureLevel:
    if cost == "low":
        return "high"
    if cost == "high":
        return "low"
    return "medium"


def _goal_overlap(option_blob: str, goals: list[str]) -> FeatureLevel | None:
    if not goals:
        return None
    stop = {"the", "and", "for", "with", "that", "this", "from", "your", "have", "into"}
    goal_words: set[str] = set()
    for g in goals:
        goal_words.update(w for w in re.findall(r"[a-zA-Z]{3,}", g.lower()) if w not in stop)
    if not goal_words:
        return None
    opt_words = {w for w in re.findall(r"[a-zA-Z]{3,}", option_blob.lower()) if w not in stop}
    overlap = len(goal_words & opt_words) / len(goal_words)
    if overlap >= 0.35:
        return "high"
    if overlap >= 0.12:
        return "medium"
    if overlap > 0:
        return "low"
    return None


def _memory_goal_level(option_blob: str, user_state: UserState) -> FeatureLevel | None:
    for src in (user_state.profile_values, user_state.goals):
        lv = _goal_overlap(option_blob, list(src))
        if lv is not None:
            return lv
    for fact in user_state.profile_memory_facts:
        pred = (fact.predicate or "").lower()
        if pred in ("goal_is", "values", "prefers", "prioritizes"):
            blob = f"{fact.object_value} {fact.text}".lower()
            if any(w in option_blob.lower() for w in re.findall(r"[a-zA-Z]{4,}", blob)):
                return "medium"
    return None


def _evidence_money_level(evidence_blob: str) -> FeatureLevel | None:
    return _keyword_level(evidence_blob, _MONEY_HIGH, _MONEY_LOW)


def _evidence_money_level_for_option(option_blob: str, evidence: EvidenceBundle) -> FeatureLevel | None:
    """Apply money evidence only when a fact/base-rate overlaps this option's terms."""
    opt_tokens = {w for w in re.findall(r"[a-zA-Z]{4,}", option_blob.lower())}
    if not opt_tokens:
        return None
    best: FeatureLevel | None = None
    for item in evidence.facts + evidence.base_rates + evidence.recent_events:
        text = (item.text or "").strip()
        if not text:
            continue
        lv = _keyword_level(text, _MONEY_HIGH, _MONEY_LOW)
        if lv is None:
            continue
        sent_tokens = {w for w in re.findall(r"[a-zA-Z]{4,}", text.lower())}
        if opt_tokens & sent_tokens:
            if best is None or lv == "high":
                best = lv
    return best


def _detect_hard_violations(
    option: Option,
    user_state: UserState,
    *,
    option_stress: FeatureLevel,
    option_workload: FeatureLevel,
) -> list[str]:
    violations: list[str] = []
    blob = f"{option.name} {option.description}".lower()
    if user_state.deadline_hint and any(k in blob for k in ("delay", "wait", "extension", "more time")):
        if user_state.time_pressure == TimePressure.HIGH:
            violations.append("delay_option_under_high_time_pressure")
    if option_stress in ("high", "medium") and user_state.stress_level >= 8 and any(
        k in blob for k in ("sprint", "commit now", "all-in", "immediate")
    ):
        violations.append("high_stress_path_while_user_stressed")
    if option_workload == "high" and user_state.workload >= 8:
        violations.append("high_workload_option_while_user_overloaded")
    for c in user_state.profile_constraints:
        c_low = c.lower()
        blob_words = re.findall(r"[a-zA-Z]{4,}", c_low)
        if blob_words and any(w in blob for w in blob_words[:4]):
            if any(k in c_low for k in _CONFLICT) or "need" in c_low or "must" in c_low:
                violations.append(f"possible_constraint_conflict:{c[:60]}")
    return violations


def _apply_resolved(
    features: dict[str, FeatureLevel],
    statuses: dict[str, str],
    provenance: list[FeatureProvenance],
    key: str,
    resolved,
) -> None:
    features[key] = resolved.level
    statuses[key] = resolved.status
    if resolved.provenance:
        provenance.append(resolved.provenance)


def extract_option_features(
    option: Option,
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
    scoring_clarification: dict[str, str] | None = None,
) -> OptionFeatureVector:
    """Build an auditable feature vector; option-level stress/workload stay unknown unless grounded."""
    option_blob = f"{option.name} {option.description} {' '.join(option.key_assumptions)}"
    overrides = parse_scoring_overrides_for_option(option.option_id, scoring_clarification)

    features: dict[str, FeatureLevel] = {k: "unknown" for k in CRITICAL_FEATURE_KEYS}
    features["constraint_conflict_level"] = "unknown"
    features["opportunity_cost_level"] = "unknown"
    features["switching_cost_level"] = "unknown"
    statuses: dict[str, str] = {}
    provenance: list[FeatureProvenance] = []

    tags = option.tradeoff_tags
    tag_conf = tags.tag_confidence if tags else 0.5
    tag_q = audit_option_tags(option, evidence)

    for key in (
        "time_cost_level",
        "money_cost_level",
        "stress_load_level",
        "workload_level",
        "upside_potential_level",
        "downside_severity_level",
    ):
        kw_map = {
            "time_cost_level": (_TIME_HIGH, _TIME_LOW),
            "money_cost_level": (_MONEY_HIGH, _MONEY_LOW),
            "stress_load_level": (_STRESS_HIGH, _STRESS_LOW),
            "workload_level": (_WORKLOAD_HIGH, _WORKLOAD_LOW),
            "upside_potential_level": (_UPSIDE_HIGH, _UPSIDE_LOW),
            "downside_severity_level": (_DOWNSIDE_HIGH, _DOWNSIDE_LOW),
        }
        pair = kw_map.get(key)
        kw = _keyword_level(option_blob, pair[0], pair[1]) if pair else None
        ev_lv = _evidence_money_level_for_option(option_blob, evidence) if key == "money_cost_level" else None
        _apply_resolved(
            features,
            statuses,
            provenance,
            key,
            resolve_feature(
                key,
                option=option,
                scoring_overrides=overrides,
                tag_level=tag_level_for(option, key),
                tag_confidence=tag_conf,
                evidence_level=ev_lv,
                keyword_level=kw,
                tag_quality_passes=tag_q.passes_quality_gate,
            ),
        )

    rev_rule = _reversibility_from_cost(option.cost_of_reversal)
    _apply_resolved(
        features,
        statuses,
        provenance,
        "reversibility_level",
        resolve_feature(
            "reversibility_level",
            option=option,
            scoring_overrides=overrides,
            rule_level=rev_rule,
            rule_confidence=0.85,
        ),
    )

    switch_lv: FeatureLevel = {"low": "low", "medium": "medium", "high": "high"}[option.cost_of_reversal]
    _apply_resolved(
        features,
        statuses,
        provenance,
        "switching_cost_level",
        resolve_feature(
            "switching_cost_level",
            option=option,
            scoring_overrides=overrides,
            rule_level=switch_lv,
            rule_confidence=0.85,
        ),
    )

    if features["downside_severity_level"] == "unknown" and features["reversibility_level"] == "low":
        _apply_resolved(
            features,
            statuses,
            provenance,
            "downside_severity_level",
            resolve_feature(
                "downside_severity_level",
                option=option,
                scoring_overrides=overrides,
                rule_level="high",
                rule_confidence=0.55,
            ),
        )

    conflict_hits = 0
    for c in user_state.profile_constraints:
        words = [w for w in re.findall(r"[a-zA-Z]{4,}", c.lower()) if len(w) > 4][:4]
        if words and any(w in option_blob.lower() for w in words):
            if any(k in c.lower() for k in _CONFLICT):
                conflict_hits += 1
    if conflict_hits > 0:
        conflict_lv: FeatureLevel = "high" if conflict_hits > 1 else "medium"
        _apply_resolved(
            features,
            statuses,
            provenance,
            "constraint_conflict_level",
            resolve_feature(
                "constraint_conflict_level",
                option=option,
                scoring_overrides=overrides,
                rule_level=conflict_lv,
                rule_confidence=0.7,
            ),
        )
    # No conflict signal → leave constraint_conflict_level as unknown (not assumed low).

    opp: FeatureLevel = "unknown"
    if features["time_cost_level"] in ("high", "medium") and features["upside_potential_level"] in ("high", "medium"):
        opp = "medium"
    elif features["time_cost_level"] == "high":
        opp = "high"
    elif features["time_cost_level"] == "low":
        opp = "low"
    if opp != "unknown":
        _apply_resolved(
            features,
            statuses,
            provenance,
            "opportunity_cost_level",
            resolve_feature(
                "opportunity_cost_level",
                option=option,
                scoring_overrides=overrides,
                rule_level=opp,
                rule_confidence=0.55,
            ),
        )

    # Goal alignment: structured G1 achievement, then tags/clarify fallback.
    if "goal_alignment_level" in overrides:
        _apply_resolved(
            features,
            statuses,
            provenance,
            "goal_alignment_level",
            resolve_feature(
                "goal_alignment_level",
                option=option,
                scoring_overrides=overrides,
                tag_quality_passes=tag_q.passes_quality_gate,
            ),
        )
    else:
        g1 = assess_structured_goal_alignment(option_blob, user_state, features)
        if g1:
            src_type = "profile_memory" if g1.status == "known" else "option_text"
            _apply_resolved(
                features,
                statuses,
                provenance,
                "goal_alignment_level",
                ResolvedFeature(
                    level=g1.level,
                    status=g1.status,
                    provenance=FeatureProvenance(
                        feature_key="goal_alignment_level",
                        value=g1.level,
                        source_type=src_type,
                        source_ref=",".join(g1.matched_themes),
                        confidence=0.8 if g1.status == "known" else 0.55,
                        note=g1.note,
                    ),
                ),
            )
        else:
            _apply_resolved(
                features,
                statuses,
                provenance,
                "goal_alignment_level",
                resolve_feature(
                    "goal_alignment_level",
                    option=option,
                    scoring_overrides=overrides,
                    tag_level=tag_level_for(option, "goal_alignment_level"),
                    tag_confidence=tag_conf,
                    tag_quality_passes=tag_q.passes_quality_gate,
                ),
            )

    hard_violations = _detect_hard_violations(
        option,
        user_state,
        option_stress=features["stress_load_level"],
        option_workload=features["workload_level"],
    )

    assumptions = list(option.key_assumptions)
    if memory and memory.behavioral_patterns:
        assumptions.extend(memory.behavioral_patterns[:2])

    missing = sum(1 for k in CRITICAL_FEATURE_KEYS if statuses.get(k, "unknown") == "unknown")

    return OptionFeatureVector(
        option_id=option.option_id,
        missing_critical_info_count=missing,
        hard_constraint_violations=hard_violations,
        assumptions=assumptions,
        provenance=provenance,
        field_status=statuses,
        **{k: features[k] for k in (
            "time_cost_level", "money_cost_level", "stress_load_level", "workload_level",
            "reversibility_level", "switching_cost_level", "downside_severity_level",
            "upside_potential_level", "goal_alignment_level", "constraint_conflict_level",
            "opportunity_cost_level",
        )},
    )


def extract_features_for_options(
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
    memory: MemoryBundle | None = None,
    scoring_clarification: dict[str, str] | None = None,
) -> list[OptionFeatureVector]:
    return [
        extract_option_features(o, user_state, evidence, memory, scoring_clarification)
        for o in options
    ]
