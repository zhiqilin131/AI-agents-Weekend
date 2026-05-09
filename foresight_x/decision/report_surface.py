"""Derive concise `ReportSurface` from a completed trace — no extra LLM calls."""

from __future__ import annotations

from typing import Literal

from foresight_x.schemas import (
    DecisionTrace,
    EvidenceReference,
    FuturePath,
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
    for pat in mem.behavioral_patterns[:2]:
        pat = pat.strip()
        if pat:
            pool.append(EvidenceReference(type="memory", text=pat))
    return _dedupe_refs(pool)


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
        based.append(EvidenceReference(type="memory", text=_truncate(eval_rationale, 200)))
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

    if mem.behavioral_patterns:
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
                based_on=[EvidenceReference(type="memory", text=snippet)],
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


def build_report_surface(trace: DecisionTrace) -> ReportSurface:
    """Construct UI surface from an assembled trace (after reflection)."""
    chosen_id = trace.recommendation.chosen_option_id.strip()
    sf = next((f for f in trace.futures if f.option_id == chosen_id), None)
    chosen_opt = _chosen_option(trace)
    pool = _shared_evidence_pool(trace)
    eval_row = next((e for e in trace.evaluations if e.option_id == chosen_id), None)
    eval_rationale = (eval_row.rationale.strip() if eval_row else "") or None

    if not _has_history_memory(trace):
        grounding = "Based mostly on current context, not past behavior."
    else:
        grounding = (
            "These futures tie what you said today to retrieved memories and tradeoffs—"
            "not a generic three-story forecast."
        )

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
        personalized_reasons=reasons,
        future_paths=paths,
        key_assumptions=assumptions,
        primary_next_action=primary,
    )
