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
from foresight_x.simulation.evaluator import evaluate_options
from foresight_x.simulation.future_simulator import simulate_futures

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
    return ordered[: len(influence.top_nodes)]


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
        merged_patterns = list(memory_bundle.behavioral_patterns)
        if top_line:
            merged_patterns.append(f"Graph influence: {top_line}")
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


def step_infer(
    user_state: UserState,
    memory_bundle: MemoryBundle,
    evidence_bundle: EvidenceBundle,
    llm: Any | None,
) -> tuple[RationalityReport, list[Option]]:
    rationality = detect_irrationality(user_state, memory_bundle, llm)
    options = generate_options(user_state, memory_bundle, evidence_bundle, llm)
    return rationality, options


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
) -> DecisionTrace:
    anchor = (anchor_now_iso.strip() if anchor_now_iso else None) or utc_timestamp()
    recommendation = recommend(
        evaluations,
        options,
        evidence_bundle,
        memory_bundle,
        user_state=user_state,
        llm=llm,
        anchor_now_iso=anchor,
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
    )
    reflection = reflect(trace, llm)
    trace = trace.model_copy(update={"reflection": reflection})
    trace = trace.model_copy(update={"report_surface": build_report_surface(trace)})
    if persist_trace:
        save_decision_trace(trace, settings=settings)
        if settings.graph_enabled:
            try:
                TemporalGraphMemory(settings.foresight_user_id, settings=settings).record_decision_trace(trace)
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
) -> Iterator[dict[str, Any]]:
    """Yield meta, partial trace fragments per stage, then ``complete`` (SSE)."""
    settings = ctx.settings or load_settings()
    run_token = start_resilience_run()
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
    did = decision_id or str(uuid.uuid4())
    ts = timestamp or utc_timestamp()
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
            if preserve_raw_input:
                original, enhanced = user_raw, user_raw
            else:
                original, enhanced = prepare_decision_text(
                    effective,
                    ctx.llm,
                    profile=profile,
                    original_override=user_raw,
                )
            per_stage_latency_ms["enhance"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["enhance"] = _provider_label_from_llm(ctx.llm) or "none"
            yield {
                "event": "partial",
                "stage": "enhance",
                "data": {"original_user_input": original, "enhanced_preview": enhanced},
            }

        user_state = _resume_model(UserState, resume_partial, "user_state")
        if resume_idx <= 1 or user_state is None:
            yield {"event": "stage", "stage": "perceive"}
            t_stage = time.perf_counter()
            user_state = build_user_state(enhanced, ctx.llm, profile=profile)
            user_state = merge_profile_into_user_state(user_state, profile)
            user_state = user_state.model_copy(update={"active_user_id": settings.foresight_user_id})
            per_stage_latency_ms["perceive"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["perceive"] = _provider_label_from_llm(ctx.llm) or "none"
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
            rationality, options = step_infer(user_state, memory_bundle, evidence_bundle, ctx.llm)
            per_stage_latency_ms["infer"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["infer"] = _provider_label_from_llm(ctx.llm) or "none"
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
            futures = simulate_futures(options, user_state, evidence_bundle, ctx.llm, memory_bundle)
            per_stage_latency_ms["simulate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["simulate"] = _provider_label_from_llm(ctx.llm) or "none"
            yield {
                "event": "partial",
                "stage": "simulate",
                "data": {"futures": [f.model_dump(mode="json") for f in futures]},
            }

        evaluations = _resume_model_list(OptionEvaluation, resume_partial, "evaluations")
        if resume_idx <= 5 or evaluations is None:
            yield {"event": "stage", "stage": "evaluate"}
            t_stage = time.perf_counter()
            evaluations = evaluate_options(futures, user_state, ctx.llm)
            per_stage_latency_ms["evaluate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["evaluate"] = _provider_label_from_llm(ctx.llm) or "none"
            yield {
                "event": "partial",
                "stage": "evaluate",
                "data": {"evaluations": [e.model_dump(mode="json") for e in evaluations]},
            }

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
        degradations = [Degradation.model_validate(e) for e in current_run_events()]
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
            resilience_events=current_run_events(),
            runtime_context=runtime_context,
            degradations=degradations,
        )
        per_stage_latency_ms["finalize"] = int(round((time.perf_counter() - t_finalize) * 1000.0))
        provider_per_stage["finalize"] = _provider_label_from_llm(ctx.llm) or "unknown"
        all_events = _ensure_runtime_degradations(current_run_events(), chaos_profile)
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
        end_resilience_run(run_token)


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
) -> DecisionTrace:
    """Execute the full RIS stack and return a ``DecisionTrace``; optionally save JSON under ``data/traces/``."""
    settings = ctx.settings or load_settings()
    run_token = start_resilience_run()
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
    did = decision_id or str(uuid.uuid4())
    ts = utc_timestamp()
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
            if preserve_raw_input:
                original, enhanced = user_raw, user_raw
            else:
                original, enhanced = prepare_decision_text(
                    effective,
                    ctx.llm,
                    profile=profile,
                    original_override=user_raw,
                )
            per_stage_latency_ms["enhance"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["enhance"] = _provider_label_from_llm(ctx.llm) or "none"

        user_state = _resume_model(UserState, resume_partial, "user_state")
        if resume_idx <= 1 or user_state is None:
            t_stage = time.perf_counter()
            user_state = build_user_state(enhanced, ctx.llm, profile=profile)
            user_state = merge_profile_into_user_state(user_state, profile)
            user_state = user_state.model_copy(update={"active_user_id": settings.foresight_user_id})
            per_stage_latency_ms["perceive"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["perceive"] = _provider_label_from_llm(ctx.llm) or "none"

        memory_bundle = _resume_model(MemoryBundle, resume_partial, "memory")
        evidence_bundle = _resume_model(EvidenceBundle, resume_partial, "evidence")
        if resume_idx <= 2 or memory_bundle is None or evidence_bundle is None:
            t_stage = time.perf_counter()
            memory_bundle, evidence_bundle = retrieve_bundles_parallel(
                user_state, ctx, exclude_decision_id=did
            )
            per_stage_latency_ms["retrieve"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["retrieve"] = _retrieve_provider_label(evidence_bundle, current_run_events())

        rationality = _resume_model(RationalityReport, resume_partial, "rationality")
        options = _resume_model_list(Option, resume_partial, "options")
        if resume_idx <= 3 or rationality is None or options is None:
            t_stage = time.perf_counter()
            rationality, options = step_infer(user_state, memory_bundle, evidence_bundle, ctx.llm)
            per_stage_latency_ms["infer"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["infer"] = _provider_label_from_llm(ctx.llm) or "none"

        futures = _resume_model_list(SimulatedFuture, resume_partial, "futures")
        if resume_idx <= 4 or futures is None:
            t_stage = time.perf_counter()
            futures = simulate_futures(options, user_state, evidence_bundle, ctx.llm, memory_bundle)
            per_stage_latency_ms["simulate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["simulate"] = _provider_label_from_llm(ctx.llm) or "none"

        evaluations = _resume_model_list(OptionEvaluation, resume_partial, "evaluations")
        if resume_idx <= 5 or evaluations is None:
            t_stage = time.perf_counter()
            evaluations = evaluate_options(futures, user_state, ctx.llm)
            per_stage_latency_ms["evaluate"] = int(round((time.perf_counter() - t_stage) * 1000.0))
            provider_per_stage["evaluate"] = _provider_label_from_llm(ctx.llm) or "none"

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
        degradations = [Degradation.model_validate(e) for e in current_run_events()]
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
            resilience_events=current_run_events(),
            runtime_context=runtime_context,
            degradations=degradations,
        )
        per_stage_latency_ms["finalize"] = int(round((time.perf_counter() - t_finalize) * 1000.0))
        provider_per_stage["finalize"] = _provider_label_from_llm(ctx.llm) or "unknown"
        all_events = _ensure_runtime_degradations(current_run_events(), chaos_profile)
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
        end_resilience_run(run_token)
