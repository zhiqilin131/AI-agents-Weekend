"""LlamaIndex Workflow wiring for Foresight-X (async entrypoint, multi-step RIS)."""

from __future__ import annotations

import uuid
from typing import Any

from llama_index.core.workflow import Event, StartEvent, StopEvent, Workflow, step

from foresight_x.config import load_settings
from foresight_x.orchestration.pipeline import (
    PipelineContext,
    finalize_trace,
    retrieve_bundles_parallel,
    step_infer,
    utc_timestamp,
)
from foresight_x.perception.layer import build_user_state
from foresight_x.perception.query_enhance import prepare_decision_text
from foresight_x.profile.merge import merge_profile_into_user_state
from foresight_x.profile.store import load_user_profile
from foresight_x.schemas import (
    EvidenceBundle,
    MemoryBundle,
    Option,
    OptionEvaluation,
    RationalityReport,
    SimulatedFuture,
    UserState,
)
from foresight_x.simulation.evaluator import evaluate_options
from foresight_x.simulation.future_simulator import simulate_futures


class ForesightStartEvent(StartEvent):
    """Kick off a run (``run()`` may also pass kwargs into this type)."""

    raw_input: str
    decision_id: str | None = None
    persist_trace: bool = True


class PerceivedEvent(Event):
    user_state: UserState
    decision_id: str
    timestamp: str
    persist_trace: bool
    original_user_input: str


class RetrievedEvent(Event):
    user_state: UserState
    decision_id: str
    timestamp: str
    persist_trace: bool
    original_user_input: str
    memory: MemoryBundle
    evidence: EvidenceBundle


class InferredEvent(Event):
    user_state: UserState
    decision_id: str
    timestamp: str
    persist_trace: bool
    original_user_input: str
    memory: MemoryBundle
    evidence: EvidenceBundle
    rationality: RationalityReport
    options: list[Option]


class SimulatedEvent(Event):
    user_state: UserState
    decision_id: str
    timestamp: str
    persist_trace: bool
    original_user_input: str
    memory: MemoryBundle
    evidence: EvidenceBundle
    rationality: RationalityReport
    options: list[Option]
    futures: list[SimulatedFuture]


class EvaluatedEvent(Event):
    user_state: UserState
    decision_id: str
    timestamp: str
    persist_trace: bool
    original_user_input: str
    memory: MemoryBundle
    evidence: EvidenceBundle
    rationality: RationalityReport
    options: list[Option]
    futures: list[SimulatedFuture]
    evaluations: list[OptionEvaluation]


class ForesightWorkflow(Workflow):
    """Async multi-step pipeline; same semantics as :func:`run_pipeline`."""

    def __init__(self, pipe_ctx: PipelineContext, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.pipe_ctx = pipe_ctx

    @step
    async def perceive(self, ev: ForesightStartEvent) -> PerceivedEvent:
        uid = ev.decision_id or str(uuid.uuid4())
        ts = utc_timestamp()
        settings = self.pipe_ctx.settings or load_settings()
        profile = load_user_profile(settings)
        original, enhanced = prepare_decision_text(ev.raw_input, self.pipe_ctx.llm, profile=profile)
        user_state = build_user_state(enhanced, self.pipe_ctx.llm, profile=profile)
        user_state = merge_profile_into_user_state(user_state, profile)
        user_state = user_state.model_copy(update={"active_user_id": settings.foresight_user_id})
        return PerceivedEvent(
            user_state=user_state,
            decision_id=uid,
            timestamp=ts,
            persist_trace=ev.persist_trace,
            original_user_input=original,
        )

    @step
    async def retrieve(self, ev: PerceivedEvent) -> RetrievedEvent:
        memory, evidence = retrieve_bundles_parallel(
            ev.user_state, self.pipe_ctx, exclude_decision_id=ev.decision_id
        )
        return RetrievedEvent(
            user_state=ev.user_state,
            decision_id=ev.decision_id,
            timestamp=ev.timestamp,
            persist_trace=ev.persist_trace,
            original_user_input=ev.original_user_input,
            memory=memory,
            evidence=evidence,
        )

    @step
    async def infer(self, ev: RetrievedEvent) -> InferredEvent:
        rationality, options = step_infer(
            ev.user_state, ev.memory, ev.evidence, self.pipe_ctx.llm
        )
        return InferredEvent(
            user_state=ev.user_state,
            decision_id=ev.decision_id,
            timestamp=ev.timestamp,
            persist_trace=ev.persist_trace,
            original_user_input=ev.original_user_input,
            memory=ev.memory,
            evidence=ev.evidence,
            rationality=rationality,
            options=options,
        )

    @step
    async def simulate(self, ev: InferredEvent) -> SimulatedEvent:
        futures = simulate_futures(
            ev.options, ev.user_state, ev.evidence, self.pipe_ctx.llm, ev.memory
        )
        return SimulatedEvent(
            user_state=ev.user_state,
            decision_id=ev.decision_id,
            timestamp=ev.timestamp,
            persist_trace=ev.persist_trace,
            original_user_input=ev.original_user_input,
            memory=ev.memory,
            evidence=ev.evidence,
            rationality=ev.rationality,
            options=ev.options,
            futures=futures,
        )

    @step
    async def evaluate(self, ev: SimulatedEvent) -> EvaluatedEvent:
        evaluations = evaluate_options(ev.futures, ev.user_state, self.pipe_ctx.llm)
        return EvaluatedEvent(
            user_state=ev.user_state,
            decision_id=ev.decision_id,
            timestamp=ev.timestamp,
            persist_trace=ev.persist_trace,
            original_user_input=ev.original_user_input,
            memory=ev.memory,
            evidence=ev.evidence,
            rationality=ev.rationality,
            options=ev.options,
            futures=ev.futures,
            evaluations=evaluations,
        )

    @step
    async def decide(self, ev: EvaluatedEvent) -> StopEvent:
        settings = self.pipe_ctx.settings or load_settings()
        trace = finalize_trace(
            decision_id=ev.decision_id,
            timestamp=ev.timestamp,
            user_state=ev.user_state,
            memory_bundle=ev.memory,
            evidence_bundle=ev.evidence,
            rationality=ev.rationality,
            options=ev.options,
            futures=ev.futures,
            evaluations=ev.evaluations,
            llm=self.pipe_ctx.llm,
            persist_trace=ev.persist_trace,
            settings=settings,
            user_memory=self.pipe_ctx.user_memory,
            original_user_input=ev.original_user_input,
            anchor_now_iso=utc_timestamp(),
        )
        return StopEvent(result=trace)


async def run_pipeline_workflow(
    ctx: PipelineContext,
    raw_input: str,
    *,
    decision_id: str | None = None,
    persist_trace: bool = True,
    workflow_timeout: float = 300.0,
):
    """Run :class:`ForesightWorkflow` and return the ``DecisionTrace`` result."""
    wf = ForesightWorkflow(ctx, timeout=workflow_timeout)
    handler = wf.run(
        start_event=ForesightStartEvent(
            raw_input=raw_input,
            decision_id=decision_id,
            persist_trace=persist_trace,
        )
    )
    return await handler
