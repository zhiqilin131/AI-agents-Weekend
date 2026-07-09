"""Synchronous RIS pipeline: Perceive → Retrieve → Infer → Simulate → Decide → Reflect."""

from __future__ import annotations

import re
import uuid
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterator

from foresight_x.config import Settings, load_settings
from foresight_x.decision.recommender import recommend
from foresight_x.decision.reflector import reflect
from foresight_x.harness.trace import save_decision_trace
from foresight_x.inference.irrationality import detect_irrationality
from foresight_x.inference.option_generator import generate_options
from foresight_x.perception.clarify_gate import merge_clarification_answers
from foresight_x.perception.layer import build_user_state
from foresight_x.perception.query_enhance import prepare_decision_text
from foresight_x.profile.merge import append_clarification_to_profile, merge_profile_into_user_state
from foresight_x.profile.store import load_user_profile, save_user_profile
from foresight_x.memory_graph import TemporalGraphMemory
from foresight_x.retrieval.memory import UserMemory
from foresight_x.retrieval.user_recent_context import merge_user_context_into_evidence
from foresight_x.retrieval.world_cache import WorldKnowledge
from foresight_x.resilience.runtime import (
    breaker_states_snapshot,
    chaos_profile_snapshot,
    chaos_mode,
    current_run_events,
    degrade,
    end_resilience_run,
    probe_linear_mcp,
    start_resilience_run,
)
from foresight_x.schemas import (
    Degradation,
    DecisionTrace,
    EvidenceBundle,
    GraphInfluenceBundle,
    InfluenceNode,
    MemoryBundle,
    Option,
    OptionEvaluation,
    RationalityReport,
    Reflection,
    ResilienceTraceInfo,
    RuntimeContext,
    SimulatedFuture,
    UserState,
)
from foresight_x.decision.report_surface import build_report_surface
from foresight_x.orchestration.degradation_policy import (
    raise_if_strict_llm_missing,
    mark_evidence_live_flag,
    reset_llm_probe_cache,
    safe_build_user_state,
    safe_evaluate_options,
    safe_prepare_decision_text,
    safe_recommend,
    safe_reflect,
    safe_simulate_futures,
    safe_step_infer,
)
from foresight_x.simulation.evaluator import evaluate_options
from foresight_x.simulation.feature_merge import ensure_option_tags
from foresight_x.simulation.future_simulator import simulate_futures
from foresight_x.simulation.scoring_clarify_gate import (
    MAX_ELICITATION_ROUNDS,
    MAX_GATE_QUESTIONS,
    elicitation_round_count,
    recommendation_is_provisional,
    scoring_clarification_attempted,
    should_pause_pipeline_for_scoring_clarify,
)
from foresight_x.simulation.comparative_elicitation import MAX_COMPARATIVE_QUESTIONS
from foresight_x.simulation.elicitation_service import merge_elicitation_answers, record_elicitation_round

_PIPELINE_STAGE_ORDER = ["enhance", "perceive", "retrieve", "infer", "simulate", "evaluate", "finalize"]
_GRAPH_DISPLAY_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "been",
    "were",
    "your",
    "about",
}


def _resume_decision_id(
    decision_id: str | None,
    resume_partial: dict[str, Any] | None,
) -> str | None:
    if decision_id and str(decision_id).strip():
        return str(decision_id).strip()
    raw = _resume_get_obj(resume_partial, "decision_id")
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    return None


def _build_scoring_clarify_resume_partial(
    *,
    decision_id: str,
    timestamp: str,
    original_user_input: str,
    enhanced_preview: str,
    user_state: UserState,
    memory_bundle: MemoryBundle,
    evidence_bundle: EvidenceBundle,
    rationality: RationalityReport,
    options: list[Option],
    futures: list[SimulatedFuture],
    feature_audit_blob: dict[str, Any] | None,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    scoring_elicitation_rounds: list[dict] | None = None,
) -> dict[str, Any]:
    """Snapshot for resuming from ``evaluate`` after pre-recommendation scoring clarify."""
    blob: dict[str, Any] = {
        "decision_id": decision_id,
        "timestamp": timestamp,
        "original_user_input": original_user_input,
        "enhanced_preview": enhanced_preview,
        "user_state": user_state.model_dump(mode="json"),
        "memory": memory_bundle.model_dump(mode="json"),
        "evidence": evidence_bundle.model_dump(mode="json"),
        "rationality": rationality.model_dump(mode="json"),
        "options": [o.model_dump(mode="json") for o in options],
        "futures": [f.model_dump(mode="json") for f in futures],
        "feature_audit": feature_audit_blob,
    }
    if scoring_clarification:
        blob["scoring_clarification"] = scoring_clarification
    if comparative_answers:
        blob["comparative_answers"] = comparative_answers
    if scoring_elicitation_rounds:
        blob["scoring_elicitation_rounds"] = scoring_elicitation_rounds
    return blob


def _stage_index(stage: str | None) -> int:
    s = (stage or "").strip().lower()
    if s not in _PIPELINE_STAGE_ORDER:
        return 0
    return _PIPELINE_STAGE_ORDER.index(s)


def _resume_get_obj(resume_partial: dict[str, Any] | None, key: str) -> Any:
    if not resume_partial:
        return None
    val = resume_partial.get(key)
    if val is not None:
        return val
    trace = resume_partial.get("trace")
    if isinstance(trace, dict):
        return trace.get(key)
    return None


def _resume_model(cls: Any, resume_partial: dict[str, Any] | None, key: str) -> Any | None:
    raw = _resume_get_obj(resume_partial, key)
    if raw is None:
        return None
    try:
        return cls.model_validate(raw)
    except Exception:
        return None


def _resume_model_list(cls: Any, resume_partial: dict[str, Any] | None, key: str) -> list[Any] | None:
    raw = _resume_get_obj(resume_partial, key)
    if not isinstance(raw, list):
        return None
    out: list[Any] = []
    for x in raw:
        try:
            out.append(cls.model_validate(x))
        except Exception:
            return None
    return out


@dataclass
class PipelineContext:
    """Dependencies for one pipeline run."""

    settings: Settings | None = None
    llm: Any | None = None
    user_memory: UserMemory | None = None
    world: WorldKnowledge | None = None


def _empty_memory() -> MemoryBundle:
    return MemoryBundle(
        similar_past_decisions=[],
        behavioral_patterns=[],
        prior_outcomes_summary="",
    )


def _empty_evidence() -> EvidenceBundle:
    return EvidenceBundle(facts=[], base_rates=[], recent_events=[])


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _provider_label_from_llm(llm: Any | None) -> str:
    """Best-effort provider:model label from the resilient gateway."""
    call = getattr(llm, "last_call", None)
    if call is None:
        return ""
    provider = str(getattr(call, "provider_used", "") or "").strip()
    model = str(getattr(call, "model_used", "") or "").strip()
    if provider and model:
        return f"{provider}:{model}"
    return provider or model


def _llm_runtime_fields(llm: Any | None) -> dict[str, str]:
    call = getattr(llm, "last_call", None)
    if call is None:
        return {}
    provider = str(getattr(call, "provider_used", "") or "").strip()
    model = str(getattr(call, "model_used", "") or "").strip()
    label = f"{provider}:{model}" if provider and model else (provider or model)
    return {
        "llm_provider_used": label,
        "llm_fallback_reason": str(getattr(call, "fallback_reason", "") or "").strip(),
    }


def _enrich_runtime_context(runtime: RuntimeContext, llm: Any | None) -> RuntimeContext:
    extra = _llm_runtime_fields(llm)
    if not extra:
        return runtime
    return runtime.model_copy(update=extra)


def _graph_theme_tokens(user_state: UserState) -> set[str]:
    text = " ".join(
        [
            user_state.raw_input or "",
            " ".join(user_state.goals or []),
            user_state.current_behavior or "",
            user_state.decision_type or "",
        ]
    )
    raw = {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text)}
    return {w for w in raw if w not in _GRAPH_DISPLAY_STOPWORDS}


def _rank_graph_nodes_for_display(influence: GraphInfluenceBundle, user_state: UserState) -> list[InfluenceNode]:
    tokens = _graph_theme_tokens(user_state)

    def _node_tokens(node: InfluenceNode) -> set[str]:
        raw = {w.lower() for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", node.label or "")}
        return {w for w in raw if w not in _GRAPH_DISPLAY_STOPWORDS}

    def _tier(node: InfluenceNode) -> int:
        if node.layer == "event" and node.node_id.startswith("event:decision:"):
            return 0
        if node.layer == "concept" and tokens and (_node_tokens(node) & tokens):
            return 1
        return 2

    def _overlap(node: InfluenceNode) -> int:
        if not tokens:
            return 0
        return len(_node_tokens(node) & tokens)

    ordered = sorted(
        influence.top_nodes,
        key=lambda n: (
            _tier(n),
            -_overlap(n),
            -float(n.score),
            n.label,
        ),
    )
    # A raw retrieval score alone is not evidence of relevance: an off-topic node
    # (tier 2 — no token overlap with the current query/goals, not a surfaced
    # decision event) can score arbitrarily high yet have nothing to do with the
    # user's situation. Never let such nodes pad out the displayed set as long as
    # at least one genuinely relevant node exists; only fall back to the raw
    # score ranking when nothing relevant was found at all (cold-start graph).
    relevant = [n for n in ordered if _tier(n) < 2]
    return relevant if relevant else ordered


def _retrieve_provider_label(
    evidence_bundle: EvidenceBundle,
    run_events: list[dict[str, Any]],
) -> str:
    """Infer retrieval provider summary for runtime.provider_per_stage."""
    tavily_degraded = any(
        "tavily" in str((ev or {}).get("component") or "").strip().lower()
        and str((ev or {}).get("error_kind") or "").strip().lower()
        in {"outage", "timeout", "5xx", "circuit_open", "brownout"}
        for ev in run_events
    )
    if tavily_degraded:
        return "cache_only"
    if evidence_bundle.recent_events:
        return "tavily"
    return "cache_only"


def _ensure_runtime_degradations(
    run_events: list[dict[str, Any]],
    chaos_profile: dict[str, str],
) -> list[dict[str, Any]]:
    if run_events:
        return list(run_events)
    synthetic: list[dict[str, Any]] = []
    for component, mode in chaos_profile.items():
        m = (mode or "").strip()
        if not m:
            continue
        synthetic.append(
            {
                "at": utc_timestamp(),
                "component": component,
                "stage": "infra_probe",
                "reason": f"chaos injection enabled ({m})",
                "retryable": True,
                "error_kind": m,
                "provider": component,
                "fallback_path": f"chaos_{m}",
            }
        )
    return synthetic


def retrieve_bundles(
    user_state: UserState,
    ctx: PipelineContext,
    *,
    exclude_decision_id: str | None = None,
) -> tuple[MemoryBundle, EvidenceBundle]:
    settings = ctx.settings or load_settings()
    influence = _graph_influence_for_state(user_state, settings=settings)
    graph_ids, graph_scores = _graph_retrieval_hints(influence)
    memory = (
        ctx.user_memory.retrieve(user_state, graph_decision_ids=graph_ids, graph_scores=graph_scores)
        if ctx.user_memory
        else _empty_memory()
    )
    evidence = ctx.world.retrieve(user_state) if ctx.world else _empty_evidence()
    memory = _augment_memory_with_graph(memory, user_state, settings=settings, influence=influence)
    evidence = merge_user_context_into_evidence(
        evidence,
        settings,
        user_state=user_state,
        memory_bundle=memory,
        exclude_decision_id=exclude_decision_id,
    )
    return memory, evidence


def retrieve_bundles_parallel(
    user_state: UserState,
    ctx: PipelineContext,
    *,
    exclude_decision_id: str | None = None,
) -> tuple[MemoryBundle, EvidenceBundle]:
    """Run memory and world retrieval concurrently (embedding + vector search; thread pool)."""

    settings = ctx.settings or load_settings()
    influence = _graph_influence_for_state(user_state, settings=settings)
    graph_ids, graph_scores = _graph_retrieval_hints(influence)

    def mem() -> MemoryBundle:
        if ctx.user_memory:
            return ctx.user_memory.retrieve(
                user_state,
                graph_decision_ids=graph_ids,
                graph_scores=graph_scores,
            )
        return _empty_memory()

    def ev() -> EvidenceBundle:
        if ctx.world:
            return ctx.world.retrieve(user_state)
        return _empty_evidence()

    with ThreadPoolExecutor(max_workers=2) as pool:
        fut_m = pool.submit(mem)
        fut_e = pool.submit(ev)
        timeout_s = float(max(1.0, settings.retrieve_parallel_timeout_sec))
        try:
            memory_bundle = fut_m.result(timeout=timeout_s)
        except FuturesTimeout:
            memory_bundle = _empty_memory()
            degrade(
                component="user_memory",
                reason="memory retrieval timed out; continuing with empty memory bundle",
                stage="retrieve",
                retryable=True,
                error_kind="timeout",
            )
        except Exception as exc:
            memory_bundle = _empty_memory()
            degrade(
                component="user_memory",
                reason="memory retrieval failed; continuing with empty memory bundle",
                stage="retrieve",
                retryable=True,
                error_kind=type(exc).__name__,
            )
        try:
            evidence_bundle = fut_e.result(timeout=timeout_s)
        except FuturesTimeout:
            evidence_bundle = _empty_evidence()
            degrade(
                component="world_knowledge",
                reason="world retrieval timed out; continuing with empty world evidence",
                stage="retrieve",
                retryable=True,
                error_kind="timeout",
            )
        except Exception as exc:
            evidence_bundle = _empty_evidence()
            degrade(
                component="world_knowledge",
                reason="world retrieval failed; continuing with empty world evidence",
                stage="retrieve",
                retryable=True,
                error_kind=type(exc).__name__,
            )
    memory_bundle = _augment_memory_with_graph(
        memory_bundle,
        user_state,
        settings=settings,
        influence=influence,
    )
    evidence_bundle = merge_user_context_into_evidence(
        evidence_bundle,
        settings,
        user_state=user_state,
        memory_bundle=memory_bundle,
        exclude_decision_id=exclude_decision_id,
    )
    return memory_bundle, evidence_bundle


def _augment_memory_with_graph(
    memory_bundle: MemoryBundle,
    user_state: UserState,
    *,
    settings: Settings,
    influence: GraphInfluenceBundle | None = None,
) -> MemoryBundle:
    """Attach graph influence signal while keeping vector retrieval as fallback baseline."""
    if not settings.graph_enabled:
        return memory_bundle
    try:
        influence = influence or TemporalGraphMemory(settings.foresight_user_id, settings=settings).influence_for(user_state)
        if influence is None:
            return memory_bundle
        display_top_nodes = _rank_graph_nodes_for_display(influence, user_state)
        display_influence = influence.model_copy(update={"top_nodes": display_top_nodes})
        ranked = list(memory_bundle.similar_past_decisions)
        if display_influence.surfaced_decision_ids and ranked:
            by_id = {p.decision_id: p for p in ranked}
            surfaced = [by_id[d] for d in display_influence.surfaced_decision_ids if d in by_id]
            surfaced_ids = {p.decision_id for p in surfaced}
            ranked = surfaced + [p for p in ranked if p.decision_id not in surfaced_ids]
        top_line = ", ".join(f"{n.label} ({n.score:.2f})" for n in display_influence.top_nodes[:4])
        # Drop stale graph-influence lines accumulated from vector retrieval of old traces;
        # always prepend the current run's graph signal so UI/reasons stay in sync.
        merged_patterns = [
            p for p in memory_bundle.behavioral_patterns if not p.strip().lower().startswith("graph influence:")
        ]
        if top_line:
            merged_patterns.insert(0, f"Graph influence: {top_line}")
        return memory_bundle.model_copy(
            update={
                "similar_past_decisions": ranked,
                "behavioral_patterns": merged_patterns[:24],
                "graph_influence": display_influence,
            }
        )
    except Exception:
        # Hard fallback to existing retrieval path.
        return memory_bundle


def _graph_influence_for_state(
    user_state: UserState,
    *,
    settings: Settings,
) -> GraphInfluenceBundle | None:
    if not settings.graph_enabled:
        return None
    try:
        return TemporalGraphMemory(settings.foresight_user_id, settings=settings).influence_for(user_state)
    except Exception:
        return None


def _graph_retrieval_hints(influence: GraphInfluenceBundle | None) -> tuple[list[str], dict[str, float]]:
    if influence is None:
        return [], {}
    ids = [str(x).strip() for x in influence.surfaced_decision_ids if str(x).strip()]
    score_by_id: dict[str, float] = {}
    for node in influence.top_nodes:
        nid = (node.node_id or "").strip()
        did = ""
        if nid.startswith("event:decision:"):
            did = nid.split("event:decision:", 1)[-1].strip()
        if did:
            score_by_id[did] = max(score_by_id.get(did, 0.0), float(node.score))
    for did in ids:
        score_by_id.setdefault(did, 0.0)
    return ids, score_by_id


def _build_scoring_clarify_payload(feature_audit, *, elicitation_round: int = 0) -> dict[str, Any]:
    gate_questions = feature_audit.clarify_questions[:MAX_GATE_QUESTIONS]
    comparative = feature_audit.comparative_questions[:MAX_COMPARATIVE_QUESTIONS]
    payload: dict[str, Any] = {
        "needs_scoring_clarification": True,
        "grounded_feature_coverage": feature_audit.grounded_feature_coverage,
        "cross_option_discrimination": feature_audit.cross_option_discrimination,
        "clarify_questions": [q.model_dump(mode="json") for q in gate_questions],
        "comparative_questions": [q.model_dump(mode="json") for q in comparative],
        "missing_fields": feature_audit.missing_fields,
        "elicitation_round": elicitation_round,
        "max_elicitation_rounds": MAX_ELICITATION_ROUNDS,
    }
    if feature_audit.alignment_report is not None:
        payload["alignment_report"] = feature_audit.alignment_report.model_dump(mode="json")
    return payload


def _resolve_scoring_clarification(
    options: list[Option],
    scoring_clarification: dict[str, str] | None,
    comparative_answers: dict[str, list[str]] | None,
    existing_clarify: dict[str, str] | None = None,
    existing_cmp: dict[str, list[str]] | None = None,
) -> tuple[dict[str, str] | None, dict[str, list[str]], list[str]]:
    if not scoring_clarification and not comparative_answers and not existing_clarify and not existing_cmp:
        return scoring_clarification, comparative_answers or {}, []
    merged, valid_cmp, errors = merge_elicitation_answers(
        scoring_clarification=scoring_clarification,
        comparative_answers=comparative_answers,
        existing_clarification=existing_clarify,
        option_ids={o.option_id for o in options},
    )
    full_cmp = dict(existing_cmp or {})
    full_cmp.update(valid_cmp)
    return merged or None, full_cmp, errors


def step_infer(
    user_state: UserState,
    memory_bundle: MemoryBundle,
    evidence_bundle: EvidenceBundle,
    llm: Any | None,
) -> tuple[RationalityReport, list[Option]]:
    rationality = detect_irrationality(user_state, memory_bundle, llm)
    options = generate_options(user_state, memory_bundle, evidence_bundle, llm)
    return rationality, ensure_option_tags(options)


def finalize_trace(
    *,
    decision_id: str,
    timestamp: str,
    user_state: UserState,
    memory_bundle: MemoryBundle,
    evidence_bundle: EvidenceBundle,
    rationality: RationalityReport,
    options: list[Option],
    futures: list[SimulatedFuture],
    evaluations: list[OptionEvaluation],
    llm: Any | None,
    persist_trace: bool,
    settings: Settings,
    user_memory: UserMemory | None = None,
    original_user_input: str = "",
    anchor_now_iso: str | None = None,
    resilience_events: list[dict[str, Any]] | None = None,
    runtime_context: RuntimeContext | None = None,
    degradations: list[Degradation] | None = None,
    feature_audit: dict[str, Any] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    scoring_recommendation_provisional: bool = False,
    scoring_elicitation_rounds: list[dict] | None = None,
) -> DecisionTrace:
    from foresight_x.config import load_settings
    from foresight_x.decision.weight_audit import build_weight_audit, composite_map
    from foresight_x.memory.profile_store import empty_profile, load_profile

    anchor = (anchor_now_iso.strip() if anchor_now_iso else None) or utc_timestamp()
    s = settings or load_settings()
    profile = load_profile(s.foresight_user_id) or empty_profile(s.foresight_user_id)
    recommendation, _rec_provider, _rec_deg = safe_recommend(
        evaluations,
        options,
        evidence_bundle,
        memory_bundle,
        user_state=user_state,
        llm=llm,
        anchor_now_iso=anchor,
    )
    composite_by_id, applied_w = composite_map(evaluations, profile.risk_posture)
    weight_audit = build_weight_audit(
        evaluations,
        composite_by_option_id=composite_by_id,
        winner_id=recommendation.chosen_option_id,
        risk_posture=profile.risk_posture,
        applied_weights=applied_w,
    )
    placeholder = Reflection(
        possible_errors=["pending"],
        uncertainty_sources=["pending"],
        model_limitations=["pending"],
        information_gaps=["pending"],
        self_improvement_signal="pending",
    )
    trace = DecisionTrace(
        decision_id=decision_id,
        timestamp=timestamp,
        original_user_input=original_user_input,
        user_state=user_state,
        memory=memory_bundle,
        evidence=evidence_bundle,
        rationality=rationality,
        options=options,
        futures=futures,
        evaluations=evaluations,
        recommendation=recommendation,
        reflection=placeholder,
        runtime=runtime_context,
        degradations=list(degradations or []),
        resilience={
            "fallback_mode": bool(resilience_events),
            "brownout_signal": any(
                str((e or {}).get("error_kind") or "").strip().lower() == "brownout"
                for e in (resilience_events or [])
            ),
            "events": list(resilience_events or []),
        },
        feature_audit=feature_audit,
        scoring_clarification=scoring_clarification,
        comparative_answers=comparative_answers,
        scoring_elicitation_rounds=scoring_elicitation_rounds,
        scoring_recommendation_provisional=scoring_recommendation_provisional,
        weight_audit=weight_audit,
    )
    reflection, _ref_provider, _ref_deg = safe_reflect(trace, llm)
    trace = trace.model_copy(update={"reflection": reflection})
    trace = trace.model_copy(update={"report_surface": build_report_surface(trace)})
    if persist_trace:
        save_decision_trace(trace, settings=s)
        if s.graph_enabled:
            try:
                TemporalGraphMemory(s.foresight_user_id, settings=s).record_decision_trace(trace)
            except Exception:
                pass
        # Vector memory is written only when an outcome is recorded (see
        # ``apply_outcome_to_memory``), not here — aligns with "write on outcome" lifecycle.
    return trace


def iter_pipeline_events(
    ctx: PipelineContext,
    raw_input: str,
    *,
    decision_id: str | None = None,
    timestamp: str | None = None,
    persist_trace: bool = True,
    anchor_now_iso: str | None = None,
    clarification_answers: dict[str, str] | None = None,
    save_clarification_to_profile: bool = False,
    preserve_raw_input: bool = False,
    clarification_profile_merge_done_externally: bool = False,
    resume_from_stage: str | None = None,
    resume_partial: dict[str, Any] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    scoring_clarification_skip: bool = False,
    pause_for_scoring_clarify: bool = True,
    confirmed_candidates: list[dict[str, str]] | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield meta, partial trace fragments per stage, then ``complete`` (SSE)."""
    settings = ctx.settings or load_settings()
    raise_if_strict_llm_missing(ctx.llm)
    run_token, run_events_buf = start_resilience_run()
    reset_llm_probe_cache()
    probe_linear_mcp()
    for provider in ("openai", "tavily"):
        mode = chaos_mode(provider)
        if mode:
            degrade(
                component=provider,
                reason=f"chaos injection enabled ({mode})",
                stage="infra_probe",
                retryable=True,
                error_kind=mode,
            )
    did = _resume_decision_id(decision_id, resume_partial) or str(uuid.uuid4())
    ts = timestamp or str(_resume_get_obj(resume_partial, "timestamp") or "") or utc_timestamp()
    anchor = (anchor_now_iso.strip() if anchor_now_iso else None) or utc_timestamp()
    resume_idx = _stage_index(resume_from_stage)
    resumed = resume_idx > 0
    pipeline_started_at = utc_timestamp()
    t0_total = time.perf_counter()
    per_stage_latency_ms: dict[str, int] = {}
    provider_per_stage: dict[str, str] = {}
    breaker_states_at_start = breaker_states_snapshot()
    chaos_profile = chaos_profile_snapshot()
    chaos_armed = any(bool(v.strip()) for v in chaos_profile.values())

    try:
        yield {"event": "meta", "decision_id": did, "timestamp": ts}
        if resumed:
            yield {
                "event": "degraded",
                "degraded": degrade(
                    component="pipeline",
                    reason=f"resuming run from stage {resume_from_stage}",
                    stage=resume_from_stage or "unknown",
                    retryable=True,
                    error_kind="stage_resume",
                ),
            }

        profile = load_user_profile(settings)
        user_raw = raw_input.strip()
        original = str(_resume_get_obj(resume_partial, "original_user_input") or "").strip()
        enhanced = str(_resume_get_obj(resume_partial, "enhanced_preview") or "").strip()
        if resume_idx <= 0 or not original or not enhanced:
            yield {"event": "stage", "stage": "enhance"}
            t_stage = time.perf_counter()
            effective = merge_clarification_answers(user_raw, clarification_answers)
            original, enhanced, enhance_provider, deg_enhance = safe_prepare_decision_text(
                effective,
                ctx.llm,
                profile=profile,
                original_override=user_raw,
                preserve_raw_input=preserve_raw_input,
            )
            per_stage_latency_ms["enhance"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["enhance"] = enhance_provider
            if deg_enhance:
                yield {"event": "degraded", "degraded": deg_enhance}
            yield {
                "event": "partial",
                "stage": "enhance",
                "data": {"original_user_input": original, "enhanced_preview": enhanced},
            }

        user_state = _resume_model(UserState, resume_partial, "user_state")
        if resume_idx <= 1 or user_state is None:
            yield {"event": "stage", "stage": "perceive"}
            t_stage = time.perf_counter()
            user_state, perceive_provider, deg_perceive = safe_build_user_state(
                enhanced, ctx.llm, profile=profile
            )
            user_state = merge_profile_into_user_state(user_state, profile)
            user_state = user_state.model_copy(update={"active_user_id": settings.foresight_user_id})
            per_stage_latency_ms["perceive"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["perceive"] = perceive_provider
            if deg_perceive:
                yield {"event": "degraded", "degraded": deg_perceive}
            yield {
                "event": "partial",
                "stage": "perceive",
                "data": {"user_state": user_state.model_dump(mode="json")},
            }

        memory_bundle = _resume_model(MemoryBundle, resume_partial, "memory")
        evidence_bundle = _resume_model(EvidenceBundle, resume_partial, "evidence")
        if resume_idx <= 2 or memory_bundle is None or evidence_bundle is None:
            yield {"event": "stage", "stage": "retrieve"}
            t_stage = time.perf_counter()
            memory_bundle, evidence_bundle = retrieve_bundles_parallel(
                user_state, ctx, exclude_decision_id=did
            )
            evidence_bundle = mark_evidence_live_flag(evidence_bundle)
            per_stage_latency_ms["retrieve"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["retrieve"] = _retrieve_provider_label(evidence_bundle, current_run_events())
            yield {
                "event": "partial",
                "stage": "retrieve",
                "data": {
                    "memory": memory_bundle.model_dump(mode="json"),
                    "evidence": evidence_bundle.model_dump(mode="json"),
                },
            }

        rationality = _resume_model(RationalityReport, resume_partial, "rationality")
        options = _resume_model_list(Option, resume_partial, "options")
        if resume_idx <= 3 or rationality is None or options is None:
            yield {"event": "stage", "stage": "infer"}
            t_stage = time.perf_counter()
            rationality, options, infer_provider, deg_infer = safe_step_infer(
                user_state, memory_bundle, evidence_bundle, ctx.llm
            )
            per_stage_latency_ms["infer"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["infer"] = infer_provider
            if deg_infer:
                yield {"event": "degraded", "degraded": deg_infer}
            yield {
                "event": "partial",
                "stage": "infer",
                "data": {
                    "rationality": rationality.model_dump(mode="json"),
                    "options": [o.model_dump(mode="json") for o in options],
                },
            }

        futures = _resume_model_list(SimulatedFuture, resume_partial, "futures")
        if resume_idx <= 4 or futures is None:
            yield {"event": "stage", "stage": "simulate"}
            t_stage = time.perf_counter()
            futures, simulate_provider, deg_sim = safe_simulate_futures(
                options, user_state, evidence_bundle, ctx.llm, memory_bundle
            )
            per_stage_latency_ms["simulate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["simulate"] = simulate_provider
            if deg_sim:
                yield {"event": "degraded", "degraded": deg_sim}
            yield {
                "event": "partial",
                "stage": "simulate",
                "data": {"futures": [f.model_dump(mode="json") for f in futures]},
            }

        evaluations = _resume_model_list(OptionEvaluation, resume_partial, "evaluations")
        feature_audit_blob: dict[str, Any] | None = None
        feature_audit = None
        prev_clarify = resume_partial.get("scoring_clarification") if isinstance(resume_partial, dict) else None
        prev_cmp = resume_partial.get("comparative_answers") if isinstance(resume_partial, dict) else None
        prev_rounds = resume_partial.get("scoring_elicitation_rounds") if isinstance(resume_partial, dict) else None
        if not isinstance(prev_clarify, dict):
            prev_clarify = None
        if not isinstance(prev_cmp, dict):
            prev_cmp = None
        if not isinstance(prev_rounds, list):
            prev_rounds = []
        coverage_before = 0.0
        if isinstance(resume_partial, dict) and isinstance(resume_partial.get("feature_audit"), dict):
            coverage_before = float(resume_partial["feature_audit"].get("grounded_feature_coverage") or 0.0)
        effective_clarify: dict[str, str] | None = None
        valid_cmp: dict[str, list[str]] = {}
        merge_errors: list[str] = []
        elicitation_rounds: list[dict] = list(prev_rounds)
        if resume_partial and isinstance(resume_partial.get("feature_audit"), dict):
            feature_audit_blob = resume_partial["feature_audit"]
        if resume_idx <= 5 or evaluations is None:
            yield {"event": "stage", "stage": "evaluate"}
            t_stage = time.perf_counter()
            effective_clarify, valid_cmp, merge_errors = _resolve_scoring_clarification(
                options,
                scoring_clarification,
                comparative_answers,
                existing_clarify=prev_clarify,
                existing_cmp=prev_cmp,
            )
            if merge_errors:
                yield {"event": "elicitation_validation", "errors": merge_errors}
            submitted_this_round = bool(scoring_clarification) or bool(comparative_answers)
            evaluations, eval_provider, deg_eval, feature_audit, options = safe_evaluate_options(
                futures,
                user_state,
                ctx.llm,
                options=options,
                evidence=evidence_bundle,
                memory=memory_bundle,
                scoring_clarification=effective_clarify,
                confirmed_candidates=confirmed_candidates,
                comparative_answers=valid_cmp or None,
            )
            if feature_audit is not None:
                feature_audit_blob = feature_audit.model_dump(mode="json")
                if submitted_this_round:
                    elicitation_rounds = record_elicitation_round(
                        elicitation_rounds,
                        comparative_answers={
                            k: v
                            for k, v in (valid_cmp or {}).items()
                            if k not in (prev_cmp or {})
                        } or dict(comparative_answers or {}),
                        scoring_clarification=dict(scoring_clarification or {}),
                        coverage_before=coverage_before,
                        coverage_after=feature_audit.grounded_feature_coverage,
                        discrimination_after=feature_audit.cross_option_discrimination,
                        source="gate",
                    )
            per_stage_latency_ms["evaluate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["evaluate"] = eval_provider
            if deg_eval:
                yield {"event": "degraded", "degraded": deg_eval}
            yield {
                "event": "partial",
                "stage": "evaluate",
                "data": {
                    "evaluations": [e.model_dump(mode="json") for e in evaluations],
                    "feature_audit": feature_audit_blob,
                },
            }
            if feature_audit and feature_audit.needs_scoring_clarification:
                rounds_count = elicitation_round_count(elicitation_rounds)
                clarify_payload = _build_scoring_clarify_payload(
                    feature_audit,
                    elicitation_round=rounds_count,
                )
                yield {"event": "scoring_clarify", "data": clarify_payload}
                if feature_audit.alignment_report and feature_audit.alignment_report.constraint_violations:
                    yield {
                        "event": "alignment_warning",
                        "data": feature_audit.alignment_report.model_dump(mode="json"),
                    }
                clarify_attempted = scoring_clarification_attempted(
                    resume_from_stage,
                    effective_clarify,
                    scoring_clarification_skip,
                    comparative_answers=valid_cmp or comparative_answers,
                )
                allow_provisional = scoring_clarification_skip or not pause_for_scoring_clarify
                if should_pause_pipeline_for_scoring_clarify(
                    feature_audit,
                    allow_provisional=allow_provisional,
                    scoring_clarification_skip=scoring_clarification_skip,
                    elicitation_rounds=rounds_count,
                ):
                    resume_blob = _build_scoring_clarify_resume_partial(
                        decision_id=did,
                        timestamp=ts,
                        original_user_input=original,
                        enhanced_preview=enhanced,
                        user_state=user_state,
                        memory_bundle=memory_bundle,
                        evidence_bundle=evidence_bundle,
                        rationality=rationality,
                        options=options,
                        futures=futures,
                        feature_audit_blob=feature_audit_blob,
                        scoring_clarification=effective_clarify,
                        comparative_answers=valid_cmp or None,
                        scoring_elicitation_rounds=elicitation_rounds,
                    )
                    yield {
                        "event": "awaiting_scoring_clarify",
                        "data": {
                            **clarify_payload,
                            "decision_id": did,
                            "resume_from_stage": "evaluate",
                            "resume_partial": resume_blob,
                            "scoring_clarification": effective_clarify,
                            "comparative_answers": valid_cmp or None,
                            "scoring_elicitation_rounds": elicitation_rounds,
                            "validation_errors": merge_errors or None,
                        },
                    }
                    return
        else:
            effective_clarify = prev_clarify
            valid_cmp = dict(prev_cmp or {})

        clarify_attempted = scoring_clarification_attempted(
            resume_from_stage,
            effective_clarify,
            scoring_clarification_skip,
            comparative_answers=valid_cmp or None,
        )
        stream_allow_provisional = scoring_clarification_skip or not pause_for_scoring_clarify
        provisional = recommendation_is_provisional(
            feature_audit,
            allow_provisional=stream_allow_provisional,
            clarification_attempted=clarify_attempted,
            elicitation_rounds=elicitation_round_count(elicitation_rounds),
        )

        yield {"event": "stage", "stage": "finalize"}
        runtime_context = RuntimeContext(
            pipeline_started_at=pipeline_started_at,
            total_latency_ms=0,
            per_stage_latency_ms=dict(per_stage_latency_ms),
            provider_per_stage=dict(provider_per_stage),
            breaker_states_at_start=breaker_states_at_start,
            breaker_states_at_end={},
            chaos_armed=chaos_armed,
            chaos_profile=chaos_profile,
        )
        t_finalize = time.perf_counter()
        degradations = [Degradation.model_validate(e) for e in run_events_buf]
        trace = finalize_trace(
            decision_id=did,
            timestamp=ts,
            user_state=user_state,
            memory_bundle=memory_bundle,
            evidence_bundle=evidence_bundle,
            rationality=rationality,
            options=options,
            futures=futures,
            evaluations=evaluations,
            llm=ctx.llm,
            persist_trace=persist_trace,
            settings=settings,
            user_memory=ctx.user_memory,
            original_user_input=original,
            anchor_now_iso=anchor,
            resilience_events=run_events_buf,
            runtime_context=runtime_context,
            degradations=degradations,
            feature_audit=feature_audit_blob,
            scoring_clarification=effective_clarify,
            comparative_answers=valid_cmp or None,
            scoring_recommendation_provisional=provisional,
            scoring_elicitation_rounds=elicitation_rounds or None,
        )
        per_stage_latency_ms["finalize"] = int(round((time.perf_counter() - t_finalize) * 1000.0))
        provider_per_stage["finalize"] = _provider_label_from_llm(ctx.llm) or "unknown"
        all_events = _ensure_runtime_degradations(run_events_buf, chaos_profile)
        runtime_context = runtime_context.model_copy(
            update={
                "total_latency_ms": int(round((time.perf_counter() - t0_total) * 1000.0)),
                "per_stage_latency_ms": dict(per_stage_latency_ms),
                "provider_per_stage": dict(provider_per_stage),
                "breaker_states_at_end": breaker_states_snapshot(),
            }
        )
        trace = trace.model_copy(
            update={
                "degradations": [Degradation.model_validate(e) for e in all_events],
                "resilience": ResilienceTraceInfo(
                    fallback_mode=bool(all_events),
                    brownout_signal=any(
                        str((e or {}).get("error_kind") or "").strip().lower() == "brownout"
                        for e in all_events
                    ),
                    events=list(all_events),
                ),
            }
        )
        runtime_context = _enrich_runtime_context(runtime_context, ctx.llm)
        trace = trace.model_copy(update={"runtime": runtime_context})
        trace = trace.model_copy(update={"report_surface": build_report_surface(trace)})
        if (
            save_clarification_to_profile
            and clarification_answers
            and not clarification_profile_merge_done_externally
        ):
            p = append_clarification_to_profile(load_user_profile(settings), clarification_answers)
            save_user_profile(p, settings=settings)
        yield {"event": "complete", "trace": trace.model_dump(mode="json")}
    finally:
        end_resilience_run(run_token, buffer=run_events_buf)


def run_pipeline(
    ctx: PipelineContext,
    raw_input: str,
    *,
    decision_id: str | None = None,
    persist_trace: bool = True,
    anchor_now_iso: str | None = None,
    clarification_answers: dict[str, str] | None = None,
    save_clarification_to_profile: bool = False,
    preserve_raw_input: bool = False,
    clarification_profile_merge_done_externally: bool = False,
    resume_from_stage: str | None = None,
    resume_partial: dict[str, Any] | None = None,
    scoring_clarification: dict[str, str] | None = None,
    comparative_answers: dict[str, list[str]] | None = None,
    scoring_clarification_skip: bool = False,
    confirmed_candidates: list[dict[str, str]] | None = None,
) -> DecisionTrace:
    """Execute the full RIS stack and return a ``DecisionTrace``; optionally save JSON under ``data/traces/``."""
    settings = ctx.settings or load_settings()
    raise_if_strict_llm_missing(ctx.llm)
    run_token, run_events_buf = start_resilience_run()
    reset_llm_probe_cache()
    probe_linear_mcp()
    for provider in ("openai", "tavily"):
        mode = chaos_mode(provider)
        if mode:
            degrade(
                component=provider,
                reason=f"chaos injection enabled ({mode})",
                stage="infra_probe",
                retryable=True,
                error_kind=mode,
            )
    did = _resume_decision_id(decision_id, resume_partial) or str(uuid.uuid4())
    ts = str(_resume_get_obj(resume_partial, "timestamp") or "") or utc_timestamp()
    anchor = (anchor_now_iso.strip() if anchor_now_iso else None) or utc_timestamp()
    pipeline_started_at = utc_timestamp()
    t0_total = time.perf_counter()
    per_stage_latency_ms: dict[str, int] = {}
    provider_per_stage: dict[str, str] = {}
    breaker_states_at_start = breaker_states_snapshot()
    chaos_profile = chaos_profile_snapshot()
    chaos_armed = any(bool(v.strip()) for v in chaos_profile.values())

    try:
        profile = load_user_profile(settings)
        user_raw = raw_input.strip()
        resume_idx = _stage_index(resume_from_stage)
        original = str(_resume_get_obj(resume_partial, "original_user_input") or "").strip()
        enhanced = str(_resume_get_obj(resume_partial, "enhanced_preview") or "").strip()
        if resume_idx <= 0 or not original or not enhanced:
            t_stage = time.perf_counter()
            effective = merge_clarification_answers(user_raw, clarification_answers)
            original, enhanced, enhance_provider, _ = safe_prepare_decision_text(
                effective,
                ctx.llm,
                profile=profile,
                original_override=user_raw,
                preserve_raw_input=preserve_raw_input,
            )
            per_stage_latency_ms["enhance"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["enhance"] = enhance_provider

        user_state = _resume_model(UserState, resume_partial, "user_state")
        if resume_idx <= 1 or user_state is None:
            t_stage = time.perf_counter()
            user_state, perceive_provider, _ = safe_build_user_state(enhanced, ctx.llm, profile=profile)
            user_state = merge_profile_into_user_state(user_state, profile)
            user_state = user_state.model_copy(update={"active_user_id": settings.foresight_user_id})
            per_stage_latency_ms["perceive"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["perceive"] = perceive_provider

        memory_bundle = _resume_model(MemoryBundle, resume_partial, "memory")
        evidence_bundle = _resume_model(EvidenceBundle, resume_partial, "evidence")
        if resume_idx <= 2 or memory_bundle is None or evidence_bundle is None:
            t_stage = time.perf_counter()
            memory_bundle, evidence_bundle = retrieve_bundles_parallel(
                user_state, ctx, exclude_decision_id=did
            )
            evidence_bundle = mark_evidence_live_flag(evidence_bundle)
            per_stage_latency_ms["retrieve"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["retrieve"] = _retrieve_provider_label(evidence_bundle, current_run_events())

        rationality = _resume_model(RationalityReport, resume_partial, "rationality")
        options = _resume_model_list(Option, resume_partial, "options")
        if resume_idx <= 3 or rationality is None or options is None:
            t_stage = time.perf_counter()
            rationality, options, infer_provider, _ = safe_step_infer(
                user_state, memory_bundle, evidence_bundle, ctx.llm
            )
            per_stage_latency_ms["infer"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["infer"] = infer_provider

        futures = _resume_model_list(SimulatedFuture, resume_partial, "futures")
        if resume_idx <= 4 or futures is None:
            t_stage = time.perf_counter()
            futures, simulate_provider, _ = safe_simulate_futures(
                options, user_state, evidence_bundle, ctx.llm, memory_bundle
            )
            per_stage_latency_ms["simulate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["simulate"] = simulate_provider

        evaluations = _resume_model_list(OptionEvaluation, resume_partial, "evaluations")
        feature_audit_blob: dict[str, Any] | None = None
        feature_audit = None
        prev_clarify = resume_partial.get("scoring_clarification") if isinstance(resume_partial, dict) else None
        prev_cmp = resume_partial.get("comparative_answers") if isinstance(resume_partial, dict) else None
        if not isinstance(prev_clarify, dict):
            prev_clarify = None
        if not isinstance(prev_cmp, dict):
            prev_cmp = None
        effective_clarify: dict[str, str] | None = prev_clarify
        valid_cmp: dict[str, list[str]] = dict(prev_cmp or {})
        elicitation_rounds: list[dict] = []
        if resume_partial and isinstance(resume_partial.get("feature_audit"), dict):
            feature_audit_blob = resume_partial["feature_audit"]
        if resume_idx <= 5 or evaluations is None:
            t_stage = time.perf_counter()
            effective_clarify, valid_cmp, _ = _resolve_scoring_clarification(
                options,
                scoring_clarification,
                comparative_answers,
                existing_clarify=prev_clarify,
                existing_cmp=prev_cmp,
            )
            evaluations, eval_provider, _, feature_audit, options = safe_evaluate_options(
                futures,
                user_state,
                ctx.llm,
                options=options,
                evidence=evidence_bundle,
                memory=memory_bundle,
                scoring_clarification=effective_clarify,
                confirmed_candidates=confirmed_candidates,
                comparative_answers=valid_cmp or None,
            )
            if feature_audit is not None:
                feature_audit_blob = feature_audit.model_dump(mode="json")
            per_stage_latency_ms["evaluate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["evaluate"] = eval_provider

        clarify_attempted = scoring_clarification_attempted(
            resume_from_stage,
            effective_clarify,
            scoring_clarification_skip,
            comparative_answers=valid_cmp or None,
        )
        provisional = recommendation_is_provisional(
            feature_audit,
            allow_provisional=scoring_clarification_skip,
            clarification_attempted=clarify_attempted,
            elicitation_rounds=elicitation_round_count(elicitation_rounds),
        )

        runtime_context = RuntimeContext(
            pipeline_started_at=pipeline_started_at,
            total_latency_ms=0,
            per_stage_latency_ms=dict(per_stage_latency_ms),
            provider_per_stage=dict(provider_per_stage),
            breaker_states_at_start=breaker_states_at_start,
            breaker_states_at_end={},
            chaos_armed=chaos_armed,
            chaos_profile=chaos_profile,
        )
        t_finalize = time.perf_counter()
        degradations = [Degradation.model_validate(e) for e in run_events_buf]
        trace = finalize_trace(
            decision_id=did,
            timestamp=ts,
            user_state=user_state,
            memory_bundle=memory_bundle,
            evidence_bundle=evidence_bundle,
            rationality=rationality,
            options=options,
            futures=futures,
            evaluations=evaluations,
            llm=ctx.llm,
            persist_trace=persist_trace,
            settings=settings,
            user_memory=ctx.user_memory,
            original_user_input=original,
            anchor_now_iso=anchor,
            resilience_events=run_events_buf,
            runtime_context=runtime_context,
            degradations=degradations,
            feature_audit=feature_audit_blob,
            scoring_clarification=effective_clarify,
            comparative_answers=valid_cmp or None,
            scoring_recommendation_provisional=provisional,
            scoring_elicitation_rounds=elicitation_rounds or None,
        )
        per_stage_latency_ms["finalize"] = int(round((time.perf_counter() - t_finalize) * 1000.0))
        provider_per_stage["finalize"] = _provider_label_from_llm(ctx.llm) or "unknown"
        all_events = _ensure_runtime_degradations(run_events_buf, chaos_profile)
        runtime_context = runtime_context.model_copy(
            update={
                "total_latency_ms": int(round((time.perf_counter() - t0_total) * 1000.0)),
                "per_stage_latency_ms": dict(per_stage_latency_ms),
                "provider_per_stage": dict(provider_per_stage),
                "breaker_states_at_end": breaker_states_snapshot(),
            }
        )
        trace = trace.model_copy(
            update={
                "degradations": [Degradation.model_validate(e) for e in all_events],
                "resilience": ResilienceTraceInfo(
                    fallback_mode=bool(all_events),
                    brownout_signal=any(
                        str((e or {}).get("error_kind") or "").strip().lower() == "brownout"
                        for e in all_events
                    ),
                    events=list(all_events),
                ),
            }
        )
        runtime_context = _enrich_runtime_context(runtime_context, ctx.llm)
        trace = trace.model_copy(update={"runtime": runtime_context})
        trace = trace.model_copy(update={"report_surface": build_report_surface(trace)})
        if (
            save_clarification_to_profile
            and clarification_answers
            and not clarification_profile_merge_done_externally
        ):
            p = append_clarification_to_profile(load_user_profile(settings), clarification_answers)
            save_user_profile(p, settings=settings)
        return trace
    finally:
        end_resilience_run(run_token, buffer=run_events_buf)
