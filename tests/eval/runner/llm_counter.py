from __future__ import annotations

import inspect
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager

from foresight_x.orchestration import llm_gateway

_STAGE_HINTS: tuple[tuple[str, str], ...] = (
    ("query_enhance.py", "enhance"),
    ("prepare_decision_text", "enhance"),
    ("layer.py", "perceive"),
    ("build_user_state", "perceive"),
    ("retrieval", "retrieve"),
    ("retrieve_bundles", "retrieve"),
    ("step_infer", "infer"),
    ("irrationality", "infer"),
    ("option_generator", "infer"),
    ("future_simulator", "simulate"),
    ("simulate_futures", "simulate"),
    ("evaluator.py", "evaluate"),
    ("evaluate_options", "evaluate"),
    ("finalize_trace", "finalize"),
    ("recommender.py", "finalize"),
    ("reflector.py", "finalize"),
    ("shadow/chat.py", "shadow"),
    ("run_shadow_turn", "shadow"),
)


def _infer_stage_from_stack() -> str:
    for frame in inspect.stack():
        filename = frame.filename.replace("\\", "/").lower()
        func = (frame.function or "").lower()
        combined = f"{filename}:{func}"
        for hint, stage in _STAGE_HINTS:
            if hint in combined:
                return stage
    return "unknown"


@contextmanager
def count_llm_calls() -> Iterator[Counter[str]]:
    counter: Counter[str] = Counter()
    original = llm_gateway.LLMGateway.structured_predict

    def wrapped(self, *args, **kwargs):
        stage = _infer_stage_from_stack()
        counter["_first_try"] += 1
        try:
            out = original(self, *args, **kwargs)
        except Exception:
            # Failed invocations do not expose attempt_count reliably.
            # We still count the first try so eval reports remain conservative.
            counter[stage] += 1
            raise
        call = getattr(self, "last_call", None)
        attempt_count = int(getattr(call, "attempt_count", 1) or 1)
        retries = max(0, attempt_count - 1)
        counter["_retries"] += retries
        counter[stage] += 1 + retries
        return out

    llm_gateway.LLMGateway.structured_predict = wrapped
    try:
        yield counter
    finally:
        llm_gateway.LLMGateway.structured_predict = original
