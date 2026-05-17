"""Per-stage graceful degradation: deterministic fallbacks when LLM or live retrieval fails."""

from __future__ import annotations

import os
from typing import Any

from foresight_x.decision.recommender import recommend
from foresight_x.decision.reflector import reflect
from foresight_x.inference.irrationality import detect_irrationality
from foresight_x.inference.option_generator import generate_options
from foresight_x.perception.layer import build_user_state
from foresight_x.perception.query_enhance import prepare_decision_text
from foresight_x.resilience.runtime import current_run_events, degrade
from foresight_x.schemas import (
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    RationalityReport,
    Recommendation,
    Reflection,
    SimulatedFuture,
    UserProfile,
    UserState,
)
from foresight_x.simulation.evaluator import evaluate_options
from foresight_x.simulation.future_simulator import simulate_futures
from foresight_x.structured_predict import structured_predict

StageDegradation = dict[str, Any]

_PROBE_CACHE: dict[int, bool] = {}


def reset_llm_probe_cache() -> None:
    _PROBE_CACHE.clear()


def _llm_probe_fails(llm: Any) -> bool:
    """Return True when a minimal structured call cannot succeed."""
    if llm is None:
        return True
    key = id(llm)
    if key in _PROBE_CACHE:
        return _PROBE_CACHE[key]
    try:
        structured_predict(llm, dict, "Return JSON object with key ok set to true.")
        _PROBE_CACHE[key] = False
        return False
    except Exception:
        _PROBE_CACHE[key] = True
        return True


def llm_unavailable(llm: Any | None, *, probe: bool | None = None) -> bool:
    """True when the pipeline should not call the LLM (missing, forced offline, or probe fails).

    Probe is **off by default** so a flaky startup check does not force template mode for the
    whole run. Set ``FX_LLM_PROBE=1`` to restore eager probing (tests / chaos demos).
    """
    if llm is None:
        return True
    if bool(getattr(llm, "_fx_force_offline", False)):
        return True
    flag = os.getenv("FX_FORCE_OFFLINE_LLM", "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    do_probe = (
        probe
        if probe is not None
        else os.getenv("FX_LLM_PROBE", "").strip().lower() in ("1", "true", "yes", "on")
    )
    if do_probe and _llm_probe_fails(llm):
        return True
    return False


def strict_llm_required() -> bool:
    """When true, pipeline should fail fast instead of deterministic fallbacks (``FX_STRICT_LLM=1``)."""
    return os.getenv("FX_STRICT_LLM", "").strip().lower() in ("1", "true", "yes", "on")


def raise_if_strict_llm_missing(llm: Any | None, *, stage: str = "pipeline") -> None:
    if strict_llm_required() and llm_unavailable(llm, probe=False):
        raise RuntimeError(
            "Full LLM pipeline required (FX_STRICT_LLM=1) but OPENAI_API_KEY is missing or "
            "FX_FORCE_OFFLINE_LLM is set. Fix .env and restart the API."
        )


def _record_stage_fallback(
    stage: str,
    *,
    reason: str,
    fallback_path: str,
    provider: str = "llm",
    error_kind: str = "llm_unavailable",
) -> StageDegradation:
    return degrade(
        component=provider,
        reason=reason,
        stage=stage,
        retryable=True,
        error_kind=error_kind,
        provider=provider,
        fallback_path=fallback_path,
    )


def _provider_label(llm: Any | None, *, offline: bool) -> str:
    if offline or llm is None:
        return "deterministic"
    call = getattr(llm, "last_call", None)
    if call is None:
        return "llm"
    provider = str(getattr(call, "provider_used", "") or "").strip()
    model = str(getattr(call, "model_used", "") or "").strip()
    if provider and model:
        return f"{provider}:{model}"
    return provider or model or "llm"


def safe_prepare_decision_text(
    raw: str,
    llm: Any | None,
    *,
    profile: UserProfile | None,
    original_override: str | None,
    preserve_raw_input: bool,
) -> tuple[str, str, str, StageDegradation | None]:
    """Returns (original, enhanced, provider_label, optional degradation event)."""
    user_raw = raw.strip()
    if preserve_raw_input:
        return user_raw, user_raw, "passthrough", None
    if llm_unavailable(llm):
        ev = _record_stage_fallback(
            "enhance",
            reason="LLM unavailable; using raw user input",
            fallback_path="preserve_raw_input",
            provider="none",
        )
        return user_raw, user_raw, "deterministic", ev
    try:
        original, enhanced = prepare_decision_text(
            raw,
            llm,
            profile=profile,
            original_override=original_override,
        )
        return original, enhanced, _provider_label(llm, offline=False), None
    except Exception as exc:
        ev = _record_stage_fallback(
            "enhance",
            reason=f"enhance failed ({type(exc).__name__}); using raw input",
            fallback_path="preserve_raw_input",
            error_kind=type(exc).__name__,
        )
        original = (original_override if original_override is not None else raw).strip()
        return original, user_raw or original, "deterministic", ev


def safe_build_user_state(
    text: str,
    llm: Any | None,
    *,
    profile: UserProfile | None,
) -> tuple[UserState, str, StageDegradation | None]:
    offline = llm_unavailable(llm)
    try:
        state = build_user_state(text, None if offline else llm, profile=profile)
        if offline:
            ev = _record_stage_fallback(
                "perceive",
                reason="LLM unavailable; heuristic user-state extraction",
                fallback_path="heuristic_user_state",
                provider="none",
            )
            return state, "deterministic", ev
        return state, _provider_label(llm, offline=False), None
    except Exception as exc:
        ev = _record_stage_fallback(
            "perceive",
            reason=f"perceive failed ({type(exc).__name__}); heuristic user-state extraction",
            fallback_path="heuristic_user_state",
            error_kind=type(exc).__name__,
        )
        return build_user_state(text, None, profile=profile), "deterministic", ev


def mark_evidence_live_flag(
    evidence: EvidenceBundle,
    run_events: list[dict[str, Any]] | None = None,
) -> EvidenceBundle:
    """Set ``live=False`` when Tavily/world live search was skipped."""
    events = run_events if run_events is not None else current_run_events()
    tavily_down = any(
        "tavily" in str((ev or {}).get("component") or "").lower()
        and str((ev or {}).get("error_kind") or "").strip().lower()
        in {"outage", "timeout", "5xx", "circuit_open", "brownout", "chaos_outage"}
        for ev in events
    )
    if tavily_down and evidence.live:
        return evidence.model_copy(update={"live": False})
    return evidence


def safe_step_infer(
    user_state: UserState,
    memory_bundle: MemoryBundle,
    evidence_bundle: EvidenceBundle,
    llm: Any | None,
) -> tuple[RationalityReport, list[Option], str, StageDegradation | None]:
    offline = llm_unavailable(llm, probe=False)
    if offline:
        if strict_llm_required():
            raise RuntimeError(
                "infer stage requires LLM (FX_STRICT_LLM=1). Check OPENAI_API_KEY in .env."
            )
        ev = _record_stage_fallback(
            "infer",
            reason="LLM unavailable; rule-based options and rationality checks",
            fallback_path="rule_options+rule_rationality",
            provider="none",
        )
        rationality = detect_irrationality(user_state, memory_bundle, None)
        options = generate_options(user_state, memory_bundle, evidence_bundle, None)
        return rationality, options, "deterministic", ev
    try:
        rationality = detect_irrationality(user_state, memory_bundle, llm)
        options = generate_options(user_state, memory_bundle, evidence_bundle, llm)
        return rationality, options, _provider_label(llm, offline=False), None
    except Exception as exc:
        ev = _record_stage_fallback(
            "infer",
            reason=f"infer failed ({type(exc).__name__}); rule-based options",
            fallback_path="rule_options+rule_rationality",
            error_kind=type(exc).__name__,
        )
        rationality = detect_irrationality(user_state, memory_bundle, None)
        options = generate_options(user_state, memory_bundle, evidence_bundle, None)
        return rationality, options, "deterministic", ev


def safe_simulate_futures(
    options: list[Option],
    user_state: UserState,
    evidence_bundle: EvidenceBundle,
    llm: Any | None,
    memory_bundle: MemoryBundle | None,
) -> tuple[list[SimulatedFuture], str, StageDegradation | None]:
    offline = llm_unavailable(llm, probe=False)
    if offline:
        if strict_llm_required():
            raise RuntimeError(
                "simulate stage requires LLM (FX_STRICT_LLM=1). Check OPENAI_API_KEY in .env."
            )
        ev = _record_stage_fallback(
            "simulate",
            reason="LLM unavailable; deterministic scenario templates per option",
            fallback_path="template_futures",
            provider="none",
        )
        futures = simulate_futures(options, user_state, evidence_bundle, None, memory_bundle)
        return futures, "deterministic", ev
    try:
        futures = simulate_futures(options, user_state, evidence_bundle, llm, memory_bundle)
        return futures, _provider_label(llm, offline=False), None
    except Exception as exc:
        if strict_llm_required():
            raise
        ev = _record_stage_fallback(
            "simulate",
            reason=f"simulate failed ({type(exc).__name__}); template futures",
            fallback_path="template_futures",
            error_kind=type(exc).__name__,
        )
        futures = simulate_futures(options, user_state, evidence_bundle, None, memory_bundle)
        return futures, "deterministic", ev


def safe_evaluate_options(
    futures: list[SimulatedFuture],
    user_state: UserState,
    llm: Any | None,
) -> tuple[list[OptionEvaluation], str, StageDegradation | None]:
    offline = llm_unavailable(llm, probe=False)
    if offline:
        if strict_llm_required():
            raise RuntimeError(
                "evaluate stage requires LLM (FX_STRICT_LLM=1). Check OPENAI_API_KEY in .env."
            )
        ev = _record_stage_fallback(
            "evaluate",
            reason="LLM unavailable; heuristic scoring from scenario weights",
            fallback_path="heuristic_mcda_scores",
            provider="none",
        )
        evaluations = evaluate_options(futures, user_state, None)
        return evaluations, "deterministic", ev
    try:
        evaluations = evaluate_options(futures, user_state, llm)
        return evaluations, _provider_label(llm, offline=False), None
    except Exception as exc:
        ev = _record_stage_fallback(
            "evaluate",
            reason=f"evaluate failed ({type(exc).__name__}); heuristic scoring",
            fallback_path="heuristic_mcda_scores",
            error_kind=type(exc).__name__,
        )
        evaluations = evaluate_options(futures, user_state, None)
        return evaluations, "deterministic", ev


def safe_recommend(
    evaluations: list[OptionEvaluation],
    options: list[Option],
    evidence: EvidenceBundle,
    memory: MemoryBundle,
    *,
    user_state: UserState,
    llm: Any | None,
    anchor_now_iso: str | None,
) -> tuple[Recommendation, str, StageDegradation | None]:
    offline = llm_unavailable(llm)
    if offline:
        ev = _record_stage_fallback(
            "recommend",
            reason="LLM unavailable; MCDA composite-score recommendation",
            fallback_path="mcda_composite_argmax",
            provider="none",
        )
        rec = recommend(
            evaluations,
            options,
            evidence,
            memory,
            user_state=user_state,
            llm=None,
            anchor_now_iso=anchor_now_iso,
        )
        return rec, "deterministic", ev
    try:
        rec = recommend(
            evaluations,
            options,
            evidence,
            memory,
            user_state=user_state,
            llm=llm,
            anchor_now_iso=anchor_now_iso,
        )
        return rec, _provider_label(llm, offline=False), None
    except Exception as exc:
        ev = _record_stage_fallback(
            "recommend",
            reason=f"recommend failed ({type(exc).__name__}); MCDA fallback",
            fallback_path="mcda_composite_argmax",
            error_kind=type(exc).__name__,
        )
        rec = recommend(
            evaluations,
            options,
            evidence,
            memory,
            user_state=user_state,
            llm=None,
            anchor_now_iso=anchor_now_iso,
        )
        return rec, "deterministic", ev


def _trace_has_provider_outage_degradations(trace: Any) -> bool:
    """True when the trace records dependency outages users should see (not offline heuristics)."""
    degradations = getattr(trace, "degradations", None) or []
    for row in degradations:
        payload = row.model_dump(mode="json") if hasattr(row, "model_dump") else row
        if isinstance(payload, dict) and should_surface_degradation_to_user(payload):
            return True
    return False


def safe_reflect(trace: Any, llm: Any | None) -> tuple[Reflection, str, StageDegradation | None]:
    offline = llm_unavailable(llm)
    provider_degraded = _trace_has_provider_outage_degradations(trace)
    if offline or provider_degraded:
        ev = _record_stage_fallback(
            "reflect",
            reason="LLM unavailable or degraded run; templated reflection",
            fallback_path="template_reflection",
            provider="none",
        )
        reflection = reflect(trace, None)
        if provider_degraded:
            extra = "This decision completed in degraded mode; provider outages were handled with deterministic fallbacks."
            reflection = reflection.model_copy(
                update={
                    "model_limitations": list(reflection.model_limitations) + [extra],
                }
            )
        return reflection, "deterministic", ev
    try:
        reflection = reflect(trace, llm)
        return reflection, _provider_label(llm, offline=False), None
    except Exception as exc:
        ev = _record_stage_fallback(
            "reflect",
            reason=f"reflect failed ({type(exc).__name__}); templated reflection",
            fallback_path="template_reflection",
            error_kind=type(exc).__name__,
        )
        return reflect(trace, None), "deterministic", ev


_SOFT_STAGE_FALLBACKS = frozenset(
    {"enhance", "perceive", "retrieve", "infer", "simulate", "evaluate", "finalize", "reflect"}
)
_RECOVERED_PROVIDER_ERROR_KINDS = frozenset(
    {
        "validationerror",
        "jsondecodeerror",
        "rate_limit_exceeded",
        "ratelimiterror",
        "apiconnectionerror",
        "timeouterror",
        "readtimeout",
    }
)
_HARD_ERROR_KINDS = frozenset(
    {"circuit_open", "outage", "timeout", "5xx", "chaos_outage", "chaos_timeout", "chaos_5xx"}
)


def should_surface_degradation_to_user(row: dict[str, Any] | None) -> bool:
    """Whether a degradation row should trigger user-facing Degraded mode UI.

    Routine stage fallbacks and recovered provider errors stay on the trace for
    resilience tooling but must not alarm users when the pipeline still completes.
    """
    if not isinstance(row, dict):
        return False
    kind = str(row.get("error_kind") or "").strip().lower()
    stage = str(row.get("stage") or "").strip().lower()
    reason = str(row.get("reason") or "").strip().lower()

    if kind in _HARD_ERROR_KINDS:
        return True
    if "circuit" in reason and "open" in reason:
        return True
    if "outage" in reason or "chaos injection" in reason:
        return True

    if kind == "llm_unavailable" and stage in _SOFT_STAGE_FALLBACKS:
        return False
    if stage == "llm_gateway" and "failing over" in reason:
        return False
    if stage == "infra_probe":
        return False
    if stage == "runtime" and kind in _RECOVERED_PROVIDER_ERROR_KINDS:
        return False
    if stage == "runtime" and kind == "brownout":
        return False
    return False
