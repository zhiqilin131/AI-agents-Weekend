"""Generate best/base/worst futures per option."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Protocol

from foresight_x.structured_predict import structured_predict
from foresight_x.prompts.future_simulator import future_simulator_prompt
from foresight_x.schemas import EvidenceBundle, MemoryBundle, Option, Scenario, SimulatedFuture, UserState


class StructuredPredictLLM(Protocol):
    def structured_predict(self, output_cls: Any, prompt: str, **kwargs: Any) -> Any:
        ...


def _normalize_probabilities(scenarios: list[Scenario]) -> list[Scenario]:
    if not scenarios:
        return scenarios
    total = sum(s.probability for s in scenarios)
    if total <= 0:
        n = len(scenarios)
        p = 1.0 / n
        return [s.model_copy(update={"probability": p}) for s in scenarios]
    if abs(total - 1.0) <= 0.05:
        return scenarios
    return [s.model_copy(update={"probability": s.probability / total}) for s in scenarios]


def _fallback_future(option: Option, user_state: UserState, evidence: EvidenceBundle) -> SimulatedFuture:
    fact_hint = evidence.facts[0].text[:120] if evidence.facts else "limited external evidence"
    oid = option.option_id
    return SimulatedFuture(
        option_id=oid,
        time_horizon="3 months",
        scenarios=_normalize_probabilities(
            [
                Scenario(
                    label="best",
                    trajectory=(
                        f"{option.name} works out: goals advance with manageable disruption. "
                        f"(Grounding hint: {fact_hint})"
                    ),
                    probability=0.25,
                    key_drivers=["execution", "alignment with goals"],
                ),
                Scenario(
                    label="base",
                    trajectory=(
                        f"Mixed outcomes for {option.name}: partial progress, some tradeoffs remain."
                    ),
                    probability=0.5,
                    key_drivers=["uncertainty", "resource constraints"],
                ),
                Scenario(
                    label="worst",
                    trajectory=(
                        f"{option.name} underperforms: key assumptions fail, recovery is costly "
                        f"given {user_state.reversibility.value} reversibility."
                    ),
                    probability=0.25,
                    key_drivers=["downside tail", "stress and workload"],
                ),
            ]
        ),
    )


def _coerce_simulated_future(raw: Any, opt: Option) -> SimulatedFuture:
    """Normalize scenario probabilities before SimulatedFuture validation (LLM may return sums ≠ 1)."""
    if isinstance(raw, SimulatedFuture):
        payload = raw.model_dump()
    elif isinstance(raw, dict):
        payload = dict(raw)
    elif hasattr(raw, "model_dump"):
        payload = raw.model_dump()
    else:
        raise TypeError(f"Unsupported SimulatedFuture payload: {type(raw)}")
    scenarios_in = payload.get("scenarios") or []
    scenarios: list[Scenario] = []
    for s in scenarios_in:
        scenarios.append(s if isinstance(s, Scenario) else Scenario.model_validate(s))
    norm_sc = _normalize_probabilities(scenarios)
    return SimulatedFuture(
        option_id=str(payload.get("option_id") or opt.option_id),
        time_horizon=str(payload.get("time_horizon") or "3 months"),
        scenarios=norm_sc,
    )


def _simulate_one_future(
    opt: Option,
    user_state: UserState,
    evidence: EvidenceBundle,
    llm: StructuredPredictLLM | None,
    memory: MemoryBundle | None = None,
) -> SimulatedFuture:
    if llm is None:
        return _fallback_future(opt, user_state, evidence)
    prompt = future_simulator_prompt(opt, user_state, evidence, memory)
    try:
        raw = structured_predict(llm, SimulatedFuture, prompt)
        return _coerce_simulated_future(raw, opt)
    except Exception:
        return _fallback_future(opt, user_state, evidence)


def simulate_futures(
    options: list[Option],
    user_state: UserState,
    evidence: EvidenceBundle,
    llm: StructuredPredictLLM | None = None,
    memory: MemoryBundle | None = None,
) -> list[SimulatedFuture]:
    """Produce a SimulatedFuture per option; LLM path uses structured output with probability normalization.

    Independent options are simulated in parallel (thread pool) to reduce wall-clock time without
    changing prompts or schemas — same outputs as sequential calls, modulo API ordering.
    """
    if not options:
        return []
    if llm is None:
        return [_simulate_one_future(o, user_state, evidence, None, memory) for o in options]

    max_workers = min(4, len(options))
    out: list[SimulatedFuture | None] = [None] * len(options)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {
            pool.submit(_simulate_one_future, opt, user_state, evidence, llm, memory): i
            for i, opt in enumerate(options)
        }
        for fut in as_completed(futs):
            idx = futs[fut]
            out[idx] = fut.result()
    return [x for x in out if x is not None]
