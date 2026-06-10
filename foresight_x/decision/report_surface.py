"""Derive concise `ReportSurface` from a completed trace — no extra LLM calls."""

from __future__ import annotations

from typing import Literal

from foresight_x.schemas import (
    DecisionTrace,
    EvidenceReference,
    FuturePath,
    GroundingSignal,
    GroundingStrength,
    NextActionSurface,
    Option,
    PersonalizedFitReason,
    ReportSurface,
    Scenario,
    SimulatedFuture,
)

PathType = Literal["expected", "friction", "pivot"]


def _truncate(text: str, max_len: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


def _dedupe_refs(refs: list[EvidenceReference]) -> list[EvidenceReference]:
    seen: set[tuple[str, str]] = set()
    out: list[EvidenceReference] = []
    for r in refs:
        key = (r.type, r.text[:120].lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _driver_to_trigger(driver: str) -> str:
    d = (driver or "").strip()
    if not d:
        return ""
    lower = d.lower()
    if lower.startswith(("if ", "when ", "after ", "once ")):
        return d[0].upper() + d[1:] if len(d) > 1 else d
    return f"When {lower[0]}{lower[1:]}"


def _has_history_memory(trace: DecisionTrace) -> bool:
    """Past-decision / pattern signal — not the same as profile constraints alone."""
    mem = trace.memory
    us = trace.user_state
    if mem.similar_past_decisions:
        return True
    if mem.memory_evidence:
        return True
    if mem.behavioral_patterns:
        return True
    if us.profile_memory_facts:
        return True
    return False


def _graph_influence_pattern_line(mem) -> str:
    """Current-run graph influence summary for display (not stale vector-retrieval patterns)."""
    gi = mem.graph_influence
    if gi is None or not gi.top_nodes:
        return ""
    tops = ", ".join(f"{n.label} ({n.score:.2f})" for n in gi.top_nodes[:4])
    return f"Graph influence: {tops}" if tops else ""


def _shared_evidence_pool(trace: DecisionTrace) -> list[EvidenceReference]:
    us = trace.user_state
    mem = trace.memory
    pool: list[EvidenceReference] = []

    if us.raw_input.strip():
        pool.append(
            EvidenceReference(
                type="user_statement",
                text=_truncate(us.raw_input, 280),
            )
        )
    for c in us.profile_constraints[:3]:
        c = c.strip()
        if c:
            pool.append(EvidenceReference(type="current_constraint", text=c))
    for row in mem.memory_evidence[:3]:
        blob = (row.memory_summary or row.source_excerpt or "").strip()
        if blob:
            pool.append(
                EvidenceReference(
                    type="memory",
                    id=row.decision_id or None,
                    text=_truncate(blob, 220),
                )
            )
    for pd in mem.similar_past_decisions[:2]:
        summ = (pd.situation_summary or "").strip()
        if summ:
            pool.append(
                EvidenceReference(
                    type="past_decision",
                    id=pd.decision_id,
                    text=_truncate(summ, 220),
                )
            )
    for p in us.profile_priorities[:2]:
        p = p.strip()
        if p:
            pool.append(EvidenceReference(type="profile", text=p))
    for fact in us.profile_memory_facts[:2]:
        t = fact.text.strip()
        if t:
            pool.append(
                EvidenceReference(
                    type="profile",
                    id=fact.id or None,
                    text=_truncate(t, 200),
                    confidence=fact.confidence,
                )
            )
    graph_line = _graph_influence_pattern_line(mem)
    if graph_line:
        pool.append(EvidenceReference(type="memory", text=graph_line))
    for pat in mem.behavioral_patterns[:2]:
        pat = pat.strip()
        if not pat or pat.lower().startswith("graph influence:"):
            continue
        pool.append(EvidenceReference(type="memory", text=pat))
    world_facts = trace.evidence.base_rates + trace.evidence.facts + trace.evidence.recent_events
    for fact in world_facts[:3]:
        t = fact.text.strip()
        if t:
            pool.append(
                EvidenceReference(
                    type="world_evidence",
                    id=fact.source_url or None,
                    text=_truncate(t, 240),
                    confidence=fact.confidence,
                )
            )
    return _dedupe_refs(pool)


def _refs_of_type(pool: list[EvidenceReference], types: set[str]) -> list[EvidenceReference]:
    return [r for r in pool if r.type in types]


def _grounding_strength(pool: list[EvidenceReference]) -> GroundingStrength:
    user_refs = _refs_of_type(pool, {"user_statement", "current_constraint"})
    personal_refs = _refs_of_type(pool, {"profile", "past_decision", "memory"})
    world_refs = _refs_of_type(pool, {"world_evidence"})
    if user_refs and len(personal_refs) >= 2:
        return "strong"
    if user_refs and (personal_refs or world_refs):
        return "mixed"
    return "thin"


def _grounding_note(strength: GroundingStrength, has_history: bool, has_world: bool) -> str:
    if strength == "strong":
        return (
            "These futures tie what you said today to retrieved memories and tradeoffs—"
            "not a generic three-story forecast."
        )
    if strength == "mixed":
        if has_history:
            return (
                "Grounded in your current context plus some personal history and memories; treat the recommendation "
                "as a strong-fit hypothesis, then verify the open questions."
            )
        if has_world:
            return (
                "Based mostly on current context plus external evidence; personal history is light, "
                "so verify fit before committing."
            )
        return "Based mostly on current context, with limited personal history behind the recommendation."
    return (
        "Based mostly on current context, not past behavior. Evidence is thin, so verify the missing facts "
        "before treating this as a final call."
    )


def _grounding_signals(
    trace: DecisionTrace,
    pool: list[EvidenceReference],
    strength: GroundingStrength,
) -> list[GroundingSignal]:
    us = trace.user_state
    refl = trace.reflection
    user_refs = _refs_of_type(pool, {"user_statement", "current_constraint"})
    personal_refs = _refs_of_type(pool, {"profile", "past_decision", "memory"})
    world_refs = _refs_of_type(pool, {"world_evidence"})
    gaps = [x.strip() for x in (refl.information_gaps + refl.uncertainty_sources) if x.strip()]

    signals: list[GroundingSignal] = []
    if user_refs:
        signals.append(
            GroundingSignal(
                type="user_context",
                label="User context",
                text=_truncate(user_refs[0].text, 180),
                strength="strong",
            )
        )
    elif us.current_behavior.strip():
        signals.append(
            GroundingSignal(
                type="user_context",
                label="User context",
                text=_truncate(us.current_behavior, 180),
                strength="mixed",
            )
        )

    if personal_refs:
        signals.append(
            GroundingSignal(
                type="personal_memory",
                label="Personal memory",
                text=_truncate(personal_refs[0].text, 180),
                strength="strong" if len(personal_refs) >= 2 else "mixed",
            )
        )
    else:
        signals.append(
            GroundingSignal(
                type="personal_memory",
                label="Personal memory",
                text="No similar past decision or durable profile memory was found for this recommendation.",
                strength="thin",
            )
        )

    if world_refs:
        signals.append(
            GroundingSignal(
                type="external_evidence",
                label="External evidence",
                text=_truncate(world_refs[0].text, 180),
                strength="mixed",
            )
        )
    else:
        signals.append(
            GroundingSignal(
                type="external_evidence",
                label="External evidence",
                text="No strong web or source-backed fact was attached to this report surface.",
                strength="thin",
            )
        )

    signals.append(
        GroundingSignal(
            type="uncertainty",
            label="Check before acting",
            text=(
                _truncate(gaps[0], 180)
                if gaps
                else "No major missing fact was surfaced, but this is still a decision aid, not final authority."
            ),
            strength="thin" if gaps else strength,
        )
    )

    fa = trace.feature_audit if isinstance(trace.feature_audit, dict) else None
    if fa and isinstance(fa.get("grounded_feature_coverage"), (int, float)):
        cov = float(fa["grounded_feature_coverage"])
        if cov < 0.55:
            missing = fa.get("missing_fields") or []
            hint = (
                _truncate(str(missing[0]), 120)
                if missing
                else "Several tradeoff features are still unknown for one or more options."
            )
            signals.append(
                GroundingSignal(
                    type="scoring_coverage",
                    label="Scoring coverage",
                    text=f"Only {int(cov * 100)}% of tradeoff features are grounded. {hint}",
                    strength="thin",
                )
            )
        elif cov >= 0.75:
            signals.append(
                GroundingSignal(
                    type="scoring_coverage",
                    label="Scoring coverage",
                    text=f"{int(cov * 100)}% of tradeoff features are grounded from tags, profile, or evidence.",
                    strength="mixed" if cov < 0.9 else "strong",
                )
            )

    if getattr(trace, "scoring_recommendation_provisional", False):
        signals.append(
            GroundingSignal(
                type="scoring_coverage",
                label="Provisional ranking",
                text=(
                    "Recommendation was issued before tradeoff features were fully grounded. "
                    "Answer scoring clarify questions or rescore to tighten the ranking."
                ),
                strength="thin",
            )
        )

    wa = trace.weight_audit if isinstance(trace.weight_audit, dict) else None
    if wa and wa.get("fragile_criteria"):
        fragile = wa.get("fragile_criteria") or []
        margin = wa.get("winner_margin")
        margin_txt = f" (margin {margin:.2f})" if isinstance(margin, (int, float)) else ""
        signals.append(
            GroundingSignal(
                type="uncertainty",
                label="Ranking sensitivity",
                text=(
                    f"Winner ranking is sensitive to weighting on: {', '.join(str(x) for x in fragile[:3])}"
                    f"{margin_txt}. Treat as provisional."
                ),
                strength="thin",
            )
        )

    return signals[:6]


def _scenario_map(sf: SimulatedFuture) -> dict[str, Scenario]:
    return {s.label: s for s in sf.scenarios}


def _watch_mix(refl, scenario: Scenario, limit: int = 5) -> list[str]:
    parts: list[str] = []
    for x in scenario.key_drivers:
        x = x.strip()
        if x and x not in parts:
            parts.append(x)
    for x in refl.uncertainty_sources:
        x = x.strip()
        if x and x not in parts:
            parts.append(x)
    for x in refl.information_gaps:
        x = x.strip()
        if x and x not in parts:
            parts.append(x)
    return parts[:limit]


def _path_actions(path_type: str) -> str:
    if path_type == "expected":
        return "Keep this direction and schedule the first concrete step."
    if path_type == "friction":
        return "Add slack for setbacks and decide in advance what “good enough” looks like."
    return "Stay adaptable: set a checkpoint to revisit whether you still want this branch."


def _build_path(
    *,
    path_type: PathType,
    title: str,
    scenario: Scenario | None,
    fallback_summary: str,
    trace: DecisionTrace,
    pool: list[EvidenceReference],
    eval_rationale: str | None,
) -> FuturePath:
    refl = trace.reflection
    if scenario:
        summary = _truncate(scenario.trajectory, 320)
        triggers = [_driver_to_trigger(d) for d in scenario.key_drivers if d.strip()]
        triggers = [t for t in triggers if t][:5]
        if not triggers:
            triggers = ["When day-to-day execution meets the assumptions behind this choice."]
        watch = _watch_mix(refl, scenario)
    else:
        summary = _truncate(fallback_summary, 320)
        triggers = [
            _truncate(x, 160)
            for x in (refl.uncertainty_sources[:2] + refl.information_gaps[:2])
            if x.strip()
        ]
        if not triggers:
            triggers = ["When stress, timeline, or new information shifts the tradeoffs."]
        watch = [
            _truncate(x, 160)
            for x in (refl.uncertainty_sources[:3] + refl.information_gaps[:3])
            if x.strip()
        ][:5]

    based = list(pool)
    if scenario:
        for d in scenario.key_drivers[:2]:
            d = d.strip()
            if d:
                based.append(EvidenceReference(type="memory", text=_truncate(d, 160)))
    if eval_rationale:
        based.append(EvidenceReference(type="tradeoff", text=_truncate(eval_rationale, 200)))
    based = _dedupe_refs(based)
    if not based:
        based = [
            EvidenceReference(
                type="user_statement",
                text=_truncate(trace.user_state.raw_input or trace.user_state.current_behavior, 200),
            )
        ]

    return FuturePath(
        path_type=path_type,
        title=title,
        summary=summary,
        trigger_conditions=triggers,
        watch_signals=watch or ["Whether your stress level or timeline materially changes."],
        recommended_action=_path_actions(path_type),
        based_on=based[:8],
    )


def _chosen_option(trace: DecisionTrace) -> Option | None:
    cid = trace.recommendation.chosen_option_id.strip()
    if not cid:
        return None
    for o in trace.options:
        if o.option_id == cid:
            return o
    return None


def _personalized_reasons(trace: DecisionTrace, pool: list[EvidenceReference]) -> list[PersonalizedFitReason]:
    mem = trace.memory
    us = trace.user_state
    rec = trace.recommendation
    reasons: list[PersonalizedFitReason] = []

    graph_line = _graph_influence_pattern_line(mem)
    if graph_line:
        chip = next((r for r in pool if graph_line[:80].lower() in r.text.lower()), None)
        reasons.append(
            PersonalizedFitReason(
                text=_truncate(f"We factor in a pattern from your history: {graph_line}", 240),
                based_on=[chip] if chip else [EvidenceReference(type="memory", text=graph_line)],
            )
        )
    elif mem.behavioral_patterns:
        p0 = mem.behavioral_patterns[0].strip()
        if p0:
            chip = next((r for r in pool if p0[:80].lower() in r.text.lower()), None)
            reasons.append(
                PersonalizedFitReason(
                    text=_truncate(f"We factor in a pattern from your history: {p0}", 240),
                    based_on=[chip] if chip else [EvidenceReference(type="memory", text=p0)],
                )
            )

    if us.profile_constraints:
        c0 = us.profile_constraints[0].strip()
        if c0:
            reasons.append(
                PersonalizedFitReason(
                    text=_truncate(f'Your stated constraint "{c0}" narrows what "reasonable" looks like.', 260),
                    based_on=[EvidenceReference(type="current_constraint", text=c0)],
                )
            )

    if mem.similar_past_decisions:
        pd = mem.similar_past_decisions[0]
        summ = (pd.situation_summary or "").strip()
        chose = (pd.chosen_option or "").strip()
        if summ:
            line = f"In a comparable moment you leaned toward: {chose or 'a specific choice'}."
            reasons.append(
                PersonalizedFitReason(
                    text=_truncate(line, 260),
                    based_on=[
                        EvidenceReference(
                            type="past_decision",
                            id=pd.decision_id,
                            text=_truncate(summ, 200),
                        )
                    ],
                )
            )

    if len(reasons) < 2 and rec.reasoning.strip():
        snippet = _truncate(rec.reasoning.strip(), 220)
        reasons.append(
            PersonalizedFitReason(
                text="The recommendation matches how your options score against goals, risk, and regret—see detailed tradeoffs if you want the numbers.",
                based_on=[EvidenceReference(type="tradeoff", text=snippet)],
            )
        )

    if len(reasons) < 2 and us.profile_priorities:
        pr = us.profile_priorities[0].strip()
        if pr:
            reasons.append(
                PersonalizedFitReason(
                    text=_truncate(f"It aligns with a priority you’ve emphasized: {pr}", 220),
                    based_on=[EvidenceReference(type="profile", text=pr)],
                )
            )

    while len(reasons) > 3:
        reasons.pop()
    return reasons[:3]


def _duration_estimate(action: str, deadline: str | None) -> str:
    if deadline and deadline.strip():
        return f"Target: {deadline.strip()}"
    a = action.lower()
    if any(k in a for k in ("week", "month", "quarter")):
        return "Spread across a few focused sessions"
    if any(k in a for k in ("call", "email", "message", "text")):
        return "About 15–30 minutes"
    if any(k in a for k in ("research", "read", "review", "compare")):
        return "About 45–90 minutes"
    return "About 20–45 minutes"


def _how_answered_line(trace: DecisionTrace) -> str:
    runtime = trace.runtime
    provider_parts: list[str] = []
    if runtime:
        llm_used = (runtime.llm_provider_used or "").strip()
        fallback_reason = (runtime.llm_fallback_reason or "").strip()
        if llm_used and llm_used not in ("unknown", "none", "deterministic"):
            if fallback_reason:
                provider_parts.append(f"Answered with backup {llm_used} ({fallback_reason})")
            else:
                provider_parts.append(f"Answered with {llm_used}")
        elif runtime.provider_per_stage:
            stages = {
                str(v).strip().lower()
                for v in runtime.provider_per_stage.values()
                if str(v).strip()
            }
            if stages and stages <= {"deterministic"}:
                provider_parts.append("Answered with deterministic fallback")
            else:
                finalize_provider = (runtime.provider_per_stage.get("finalize") or "").strip()
                infer_provider = (runtime.provider_per_stage.get("infer") or "").strip()
                chosen = finalize_provider or infer_provider
                if chosen and chosen not in ("unknown", "none", "deterministic"):
                    if ":" in chosen:
                        provider_parts.append(f"Answered with {chosen}")
                    else:
                        provider_parts.append(f"Answered with {chosen} model")

    if not provider_parts:
        for d in trace.degradations:
            kind = (d.error_kind or "").strip().lower()
            comp = (d.component or "").strip().lower()
            path = (d.fallback_path or "").strip()
            if kind in {
                "llm_unavailable",
                "timeout",
                "ratelimiterror",
                "internalservererror",
                "circuit_open",
            } or path or "llm" in comp:
                provider_parts.append("Answered with deterministic fallback")
                break

    cache_part = ""
    for ev in trace.degradations:
        comp = (ev.component or "").strip().lower()
        kind = (ev.error_kind or "").strip().lower()
        if "tavily" in comp and kind in {"outage", "timeout", "5xx", "circuit_open", "brownout"}:
            cache_part = "Tavily cached"
            break
    if not cache_part and trace.resilience:
        # Backward compatibility for traces that only carry resilience.events.
        raw_events = (
            trace.resilience.events
            if hasattr(trace.resilience, "events")
            else (trace.resilience.get("events", []) if isinstance(trace.resilience, dict) else [])
        )
        for ev in raw_events:
            if not isinstance(ev, dict):
                continue
            comp = str(ev.get("component") or "").strip().lower()
            kind = str(ev.get("error_kind") or "").strip().lower()
            if "tavily" in comp and kind in {"outage", "timeout", "5xx", "circuit_open", "brownout"}:
                cache_part = "Tavily cached"
                break

    text = " — ".join([x for x in provider_parts if x])
    if cache_part:
        text = f"{text} — {cache_part}" if text else cache_part
    return text.strip(" —")


def build_report_surface(trace: DecisionTrace) -> ReportSurface:
    """Construct UI surface from an assembled trace (after reflection)."""
    chosen_id = trace.recommendation.chosen_option_id.strip()
    sf = next((f for f in trace.futures if f.option_id == chosen_id), None)
    chosen_opt = _chosen_option(trace)
    pool = _shared_evidence_pool(trace)
    eval_row = next((e for e in trace.evaluations if e.option_id == chosen_id), None)
    eval_rationale = (eval_row.rationale.strip() if eval_row else "") or None
    grounding_strength = _grounding_strength(pool)
    grounding = _grounding_note(
        grounding_strength,
        has_history=_has_history_memory(trace),
        has_world=bool(_refs_of_type(pool, {"world_evidence"})),
    )
    grounding_signals = _grounding_signals(trace, pool, grounding_strength)

    fallback_body = trace.recommendation.reasoning.strip() or trace.user_state.raw_input.strip()
    fb_expected = fallback_body or "If things progress steadily, this choice compounds quietly over time."
    fb_friction = (
        (trace.reflection.possible_errors[0] if trace.reflection.possible_errors else "")
        or "Friction shows up when assumptions slip or capacity tightens."
    )
    fb_pivot = (
        (trace.reflection.uncertainty_sources[0] if trace.reflection.uncertainty_sources else "")
        or "A pivot becomes plausible if the upside appears or constraints loosen."
    )

    paths: list[FuturePath] = []
    if sf and sf.scenarios:
        sm = _scenario_map(sf)
        paths.append(
            _build_path(
                path_type="expected",
                title="Expected Path",
                scenario=sm.get("base"),
                fallback_summary=fb_expected,
                trace=trace,
                pool=pool,
                eval_rationale=eval_rationale,
            )
        )
        paths.append(
            _build_path(
                path_type="friction",
                title="Friction Path",
                scenario=sm.get("worst"),
                fallback_summary=fb_friction,
                trace=trace,
                pool=pool,
                eval_rationale=eval_rationale,
            )
        )
        paths.append(
            _build_path(
                path_type="pivot",
                title="Pivot Path",
                scenario=sm.get("best"),
                fallback_summary=fb_pivot,
                trace=trace,
                pool=pool,
                eval_rationale=eval_rationale,
            )
        )
    else:
        paths = [
            _build_path(
                path_type="expected",
                title="Expected Path",
                scenario=None,
                fallback_summary=fb_expected,
                trace=trace,
                pool=pool,
                eval_rationale=eval_rationale,
            ),
            _build_path(
                path_type="friction",
                title="Friction Path",
                scenario=None,
                fallback_summary=fb_friction,
                trace=trace,
                pool=pool,
                eval_rationale=eval_rationale,
            ),
            _build_path(
                path_type="pivot",
                title="Pivot Path",
                scenario=None,
                fallback_summary=fb_pivot,
                trace=trace,
                pool=pool,
                eval_rationale=eval_rationale,
            ),
        ]

    assumptions: list[str] = []
    if chosen_opt and chosen_opt.key_assumptions:
        assumptions = [_truncate(a, 240) for a in chosen_opt.key_assumptions[:8]]
    elif trace.options:
        for o in trace.options:
            if o.option_id == chosen_id:
                assumptions = [_truncate(a, 240) for a in o.key_assumptions[:8]]
                break

    na = trace.recommendation.next_actions
    if na:
        first = na[0]
        primary = NextActionSurface(
            text=first.action.strip(),
            duration_estimate=_duration_estimate(first.action, first.deadline),
            deadline=(first.deadline.strip() if first.deadline else None) or None,
        )
    else:
        primary = NextActionSurface(
            text="Capture your decision in one sentence and pick a single next checkpoint.",
            duration_estimate="About 10 minutes",
            deadline=None,
        )

    reasons = _personalized_reasons(trace, pool)
    if not reasons:
        reasons = [
            PersonalizedFitReason(
                text="We weighted your stated situation against the option tradeoffs surfaced in this run.",
                based_on=pool[:2]
                or [
                    EvidenceReference(
                        type="user_statement",
                        text=_truncate(trace.user_state.raw_input, 200),
                    )
                ],
            )
        ]

    return ReportSurface(
        grounding_note=grounding,
        grounding_strength=grounding_strength,
        grounding_signals=grounding_signals,
        how_answered=_how_answered_line(trace),
        personalized_reasons=reasons,
        future_paths=paths,
        key_assumptions=assumptions,
        primary_next_action=primary,
    )
