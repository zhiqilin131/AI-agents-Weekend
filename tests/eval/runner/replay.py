from __future__ import annotations

import time
import traceback
from dataclasses import dataclass
from typing import Any

from foresight_x.config import load_settings
from foresight_x.orchestration.pipeline import DecisionTrace, run_pipeline
from foresight_x.shadow.chat import run_shadow_turn
from foresight_x.ui.cli import _build_context
from tests.eval.schema import Scenario


@dataclass
class TurnResult:
    turn_index: int
    user_input: str
    system_output: str
    decision_trace: DecisionTrace | None
    stage_latency_ms: dict[str, int]
    total_latency_ms: int
    llm_calls: dict[str, int]
    error: str | None


def _build_cross_session_prompt(history_user_turns: list[str], final_user_turn: str) -> str:
    if not history_user_turns:
        return final_user_turn
    context_lines = "\n".join(f"- {x}" for x in history_user_turns if x.strip())
    return (
        "Conversation context from earlier turns:\n"
        f"{context_lines}\n\n"
        "Now answer this current request:\n"
        f"{final_user_turn}"
    )


def _run_decision_turn(
    *,
    scenario: Scenario,
    user_input: str,
    turn_index: int,
    model_id: str,
) -> TurnResult:
    settings = load_settings()
    ctx, _ = _build_context(settings, llm_model=model_id)
    t0 = time.perf_counter()
    try:
        trace = run_pipeline(
            ctx,
            user_input,
            decision_id=f"eval-{scenario.id}-t{turn_index}",
            persist_trace=False,
        )
        total_ms = int(round((time.perf_counter() - t0) * 1000.0))
        runtime = trace.runtime
        stage_latency_ms = dict(runtime.per_stage_latency_ms) if runtime else {}
        total_latency_ms = int(runtime.total_latency_ms) if runtime else total_ms
        return TurnResult(
            turn_index=turn_index,
            user_input=user_input,
            system_output=trace.recommendation.reasoning or "",
            decision_trace=trace,
            stage_latency_ms=stage_latency_ms,
            total_latency_ms=total_latency_ms,
            llm_calls={},
            error=None,
        )
    except Exception:
        return TurnResult(
            turn_index=turn_index,
            user_input=user_input,
            system_output="",
            decision_trace=None,
            stage_latency_ms={},
            total_latency_ms=int(round((time.perf_counter() - t0) * 1000.0)),
            llm_calls={},
            error=traceback.format_exc(),
        )


def _run_shadow_turn_eval(
    *,
    scenario: Scenario,
    messages: list[dict[str, Any]],
    turn_index: int,
    thread_id: str,
    model_id: str,
) -> TurnResult:
    settings = load_settings()
    t0 = time.perf_counter()
    user_input = str(messages[-1].get("content", "")).strip()
    try:
        out = run_shadow_turn(
            messages,
            settings=settings,
            thread_id=thread_id,
            llm_model=model_id,
        )
        total_ms = int(round((time.perf_counter() - t0) * 1000.0))
        return TurnResult(
            turn_index=turn_index,
            user_input=user_input,
            system_output=out.reply,
            decision_trace=None,
            stage_latency_ms={"shadow": total_ms},
            total_latency_ms=total_ms,
            llm_calls={},
            error=None,
        )
    except Exception:
        return TurnResult(
            turn_index=turn_index,
            user_input=user_input,
            system_output="",
            decision_trace=None,
            stage_latency_ms={},
            total_latency_ms=int(round((time.perf_counter() - t0) * 1000.0)),
            llm_calls={},
            error=traceback.format_exc(),
        )


def replay_scenario(scenario: Scenario, *, model_id: str | None = None) -> list[TurnResult]:
    active_model = (model_id or scenario.metadata.model_id).strip() or scenario.metadata.model_id
    if isinstance(scenario.input, str):
        if scenario.category in {"decision", "cross_session"}:
            return [
                _run_decision_turn(
                    scenario=scenario,
                    user_input=scenario.input,
                    turn_index=0,
                    model_id=active_model,
                )
            ]
        msgs = [{"role": "user", "content": scenario.input}]
        return [
            _run_shadow_turn_eval(
                scenario=scenario,
                messages=msgs,
                turn_index=0,
                thread_id=f"eval-{scenario.id}",
                model_id=active_model,
            )
        ]

    turns = [str(t.get("content", "")).strip() for t in scenario.input if str(t.get("role")) == "user"]
    thread_id = f"eval-{scenario.id}"
    if scenario.category == "cross_session":
        if not turns:
            return []
        if len(turns) == 1:
            return [
                _run_decision_turn(
                    scenario=scenario,
                    user_input=turns[0],
                    turn_index=0,
                    model_id=active_model,
                )
            ]
        results: list[TurnResult] = []
        for idx, user_text in enumerate(turns[:-1]):
            results.append(
                TurnResult(
                    turn_index=idx,
                    user_input=user_text,
                    system_output="",
                    decision_trace=None,
                    stage_latency_ms={},
                    total_latency_ms=0,
                    llm_calls={},
                    error=None,
                )
            )
        final_prompt = _build_cross_session_prompt(turns[:-1], turns[-1])
        results.append(
            _run_decision_turn(
                scenario=scenario,
                user_input=final_prompt,
                turn_index=len(turns) - 1,
                model_id=active_model,
            )
        )
        return results

    messages: list[dict[str, Any]] = []
    results = []
    for idx, user_text in enumerate(turns):
        messages.append({"role": "user", "content": user_text})
        result = _run_shadow_turn_eval(
            scenario=scenario,
            messages=list(messages),
            turn_index=idx,
            thread_id=thread_id,
            model_id=active_model,
        )
        results.append(result)
        if result.system_output:
            messages.append({"role": "assistant", "content": result.system_output})
    return results
