from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any
from urllib.parse import urlparse

import yaml
from openai import OpenAI

from foresight_x.config import Settings
from foresight_x.profile.store import save_user_profile
from foresight_x.retrieval.memory import UserMemory
from foresight_x.schemas import (
    DecisionTrace,
    EvidenceBundle,
    MemoryBundle,
    NextAction,
    OptionEvaluation,
    PastDecision,
    RationalityReport,
    Recommendation,
    Reflection,
    Reversibility,
    TimePressure,
    UserProfile,
    UserState,
)
from tests.eval.runner.llm_counter import count_llm_calls
from tests.eval.runner.metrics import score_coverage, score_latency, score_recommendation, score_retrieval
from tests.eval.runner.replay import TurnResult, replay_scenario
from tests.eval.runner.safety_check import check_safety_rules, evaluate_must_not_violate, summarize_safety_metric
from tests.eval.schema import PersonaFixture, Scenario


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _git_sha() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
        return out or "unknown"
    except Exception:
        return "unknown"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _eval_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _load_scenarios() -> list[Scenario]:
    scenario_dir = _eval_root() / "scenarios"
    out: list[Scenario] = []
    for path in sorted(scenario_dir.glob("*.yaml")):
        out.append(Scenario(**yaml.safe_load(path.read_text(encoding="utf-8"))))
    return out


def _resolve_scenarios(spec: str, all_scenarios: list[Scenario]) -> list[Scenario]:
    if spec.strip().lower() == "all":
        return list(all_scenarios)
    tokens = [x.strip() for x in spec.split(",") if x.strip()]
    if not tokens:
        raise ValueError("No scenarios selected.")
    selected: list[Scenario] = []
    by_id = {s.id: s for s in all_scenarios}
    for token in tokens:
        if token in by_id:
            selected.append(by_id[token])
            continue
        matches = [s for s in all_scenarios if s.id.startswith(token)]
        if len(matches) == 1:
            selected.append(matches[0])
            continue
        if not matches:
            raise ValueError(f"Unknown scenario selector: {token}")
        raise ValueError(f"Ambiguous selector '{token}': {[m.id for m in matches]}")
    return selected


def _persona_path(persona_id: str) -> Path:
    return _eval_root() / "fixtures" / "personas" / f"{persona_id}.json"


def _seed_persona_context(*, persona_id: str, model_id: str, runtime_data_root: Path) -> None:
    persona = PersonaFixture.model_validate_json(_persona_path(persona_id).read_text(encoding="utf-8"))
    persona_root = runtime_data_root / f"persona_{persona_id}"
    chroma_dir = persona_root / "chroma"
    settings = Settings(
        foresight_data_dir=persona_root,
        chroma_persist_dir=chroma_dir,
        foresight_user_id=f"eval_persona_{persona_id}",
        openai_model=model_id,
    )
    os.environ["FORESIGHT_DATA_DIR"] = str(persona_root)
    os.environ["CHROMA_PERSIST_DIR"] = str(chroma_dir)
    os.environ["FORESIGHT_USER_ID"] = settings.foresight_user_id
    os.environ["OPENAI_MODEL"] = model_id

    profile_payload = persona.model_dump(mode="json", exclude={"past_decisions"})
    profile = UserProfile.model_validate(profile_payload)
    save_user_profile(profile, settings=settings)

    # Best effort seeding of memory index; no hard failure if embeddings are unavailable.
    if not (settings.openai_api_key or "").strip():
        return
    try:
        user_memory = UserMemory(settings.foresight_user_id, settings=settings)
        for row in persona.past_decisions:
            past = PastDecision(
                decision_id=str(row.get("id", "")).strip(),
                situation_summary=str(row.get("situation_summary", "")).strip(),
                chosen_option=str(row.get("chosen_option", "")).strip(),
                outcome=str(row.get("outcome", "")).strip() or None,
                timestamp=str(row.get("timestamp", "")).strip() or _utc_now_iso(),
            )
            user_memory.add_past_decision(
                past,
                packaged_seed=True,
                decision_type=str(row.get("decision_type", "")).strip() or None,
            )
    except Exception:
        # Keep eval runnable even when vector deps/keys are unavailable.
        pass


def _llm_preflight(model_id: str) -> tuple[bool, str | None]:
    settings = Settings(openai_model=model_id)
    if not (settings.openai_api_key or "").strip():
        return True, None
    proxy_env = (
        os.getenv("HTTPS_PROXY")
        or os.getenv("https_proxy")
        or os.getenv("ALL_PROXY")
        or os.getenv("all_proxy")
    )
    if proxy_env:
        parsed_proxy = urlparse(proxy_env)
        proxy_host = parsed_proxy.hostname
        proxy_port = int(parsed_proxy.port or 7890)
        if proxy_host:
            try:
                with socket.create_connection((proxy_host, proxy_port), timeout=2.5):
                    return True, None
            except OSError as exc:
                return False, f"llm_preflight_failed: cannot connect to proxy {proxy_host}:{proxy_port} ({exc})"

    base = (settings.openai_api_base or "").strip()
    if base:
        parsed = urlparse(base if "://" in base else f"https://{base}")
        host = parsed.hostname or "api.openai.com"
        port = int(parsed.port or (443 if (parsed.scheme or "https") == "https" else 80))
    else:
        host = "api.openai.com"
        port = 443
    try:
        with socket.create_connection((host, port), timeout=2.5):
            return True, None
    except OSError as exc:
        return False, f"llm_preflight_failed: cannot connect to {host}:{port} ({exc})"


def verify_model_available(model_id: str, settings: Settings) -> None:
    if not (settings.openai_api_key or "").strip():
        raise RuntimeError("Model availability check failed: OPENAI_API_KEY is missing.")
    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=(settings.openai_api_base or None),
    )
    try:
        client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=1,
        )
    except Exception as exc:
        raise RuntimeError(f"Model {model_id} not available: {exc}") from exc


def _counter_to_stage_calls(counter: dict[str, int]) -> tuple[int, int, int, dict[str, int]]:
    first_try = int(counter.get("_first_try", 0))
    retries = int(counter.get("_retries", 0))
    total = first_try + retries
    by_stage = {
        str(k): int(v)
        for k, v in counter.items()
        if not str(k).startswith("_")
    }
    return total, first_try, retries, by_stage


def detect_silent_degradation(decision_trace: DecisionTrace | None, model_id: str) -> list[str] | None:
    if decision_trace is None or decision_trace.runtime is None:
        return None
    provider_info = decision_trace.runtime.provider_per_stage or {}
    if not provider_info:
        return None

    expected_provider = "openai"
    if ":" in model_id:
        expected_provider = model_id.split(":", 1)[0].strip().lower() or "openai"

    degraded: list[str] = []
    llm_stages = {"enhance", "perceive", "infer", "simulate", "evaluate", "finalize", "shadow"}
    sentinel_values = {"none", "heuristic", "fallback", "unknown", ""}
    for stage, provider in provider_info.items():
        if stage not in llm_stages:
            continue
        provider_str = str(provider or "").strip().lower()
        if provider_str in sentinel_values:
            degraded.append(stage)
            continue
        if not provider_str.startswith(expected_provider):
            degraded.append(stage)
    if not degraded:
        return None
    return sorted(set(degraded))


def _trace_for_safety(turn: TurnResult, scenario_id: str) -> DecisionTrace:
    if turn.decision_trace is not None:
        return turn.decision_trace
    state = UserState(
        raw_input=turn.user_input,
        goals=[],
        time_pressure=TimePressure.MEDIUM,
        stress_level=5,
        workload=5,
        current_behavior="evaluating",
        decision_type="unknown",
        reversibility=Reversibility.PARTIAL,
    )
    return DecisionTrace(
        decision_id=f"eval-{scenario_id}-safety",
        timestamp=_utc_now_iso(),
        original_user_input=turn.user_input,
        user_state=state,
        memory=MemoryBundle(similar_past_decisions=[], behavioral_patterns=[], prior_outcomes_summary=""),
        evidence=EvidenceBundle(facts=[], base_rates=[], recent_events=[]),
        rationality=RationalityReport(
            is_rational_state=True,
            detected_biases=[],
            confidence=0.5,
            recommended_slowdowns=[],
        ),
        options=[],
        futures=[],
        evaluations=[],
        recommendation=Recommendation(
            chosen_option_id="",
            reasoning="",
            next_actions=[],
            reassessment_triggers=[],
        ),
        reflection=Reflection(
            possible_errors=[],
            uncertainty_sources=[],
            model_limitations=[],
            information_gaps=[],
            self_improvement_signal="",
        ),
    )


def _evaluate_safety(scenario: Scenario, results: list[TurnResult]) -> dict[str, Any]:
    scope = scenario.expected.safety_assertion_scope
    turns_to_check = results if scope == "all_turns" else (results[-1:] if results else [])
    per_turn_rule_checks: list[dict[str, bool]] = []
    per_turn_violations: list[dict[str, str]] = []
    for turn in turns_to_check:
        trace = _trace_for_safety(turn, scenario.id)
        rule_checks = check_safety_rules(
            trace=trace,
            user_input=turn.user_input,
            system_output=turn.system_output,
            safety_rules=list(scenario.expected.safety_rules),
        )
        violations = evaluate_must_not_violate(
            must_not_violate=list(scenario.expected.must_not_violate),
            system_output=turn.system_output,
            safety_rule_results=rule_checks,
        )
        per_turn_rule_checks.append(rule_checks)
        per_turn_violations.append(violations)

    merged_rules: dict[str, bool] = {}
    for rule in scenario.expected.safety_rules:
        merged_rules[rule] = all(check.get(rule, False) for check in per_turn_rule_checks) if per_turn_rule_checks else True

    merged_violations: dict[str, str] = {}
    for rule in scenario.expected.must_not_violate:
        rule_vals = [v.get(rule, "pass") for v in per_turn_violations]
        merged_violations[rule] = "pass" if all(x == "pass" for x in rule_vals) else "fail"

    return summarize_safety_metric(scope=scope, rules=merged_rules, violations=merged_violations)


def _scenario_status(metrics: dict[str, Any], errors: list[str], *, known_backend_issue: str | None = None) -> str:
    if errors:
        return "error"
    checks: list[bool] = []

    retrieval = metrics.get("retrieval", {})
    if "skipped" not in retrieval:
        checks.append(float(retrieval.get("recall", 0.0)) >= 1.0)
        checks.append(len(retrieval.get("missing_ids", [])) == 0)

    recommendation = metrics.get("recommendation", {})
    checks.append(bool(recommendation.get("fields_complete", False)))

    latency = metrics.get("latency", {})
    checks.append(bool(latency.get("within_budget", False)))

    safety = metrics.get("safety", {})
    if not (known_backend_issue or "").strip():
        checks.append(all(bool(v) for v in safety.get("rules", {}).values()))
        checks.append(all(v == "pass" for v in safety.get("violations", {}).values()))

    llm_calls = metrics.get("llm_calls", {})
    checks.append(bool(llm_calls.get("within_budget", False)))
    return "pass" if all(checks) else "fail"


def _aggregate(scenarios: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(scenarios)
    pass_count = sum(1 for x in scenarios if x.get("status") == "pass")
    latencies = [int(x.get("metrics", {}).get("latency", {}).get("total_ms", 0)) for x in scenarios]
    latencies = sorted(latencies)
    if latencies:
        p50 = int(median(latencies))
        idx95 = max(0, min(len(latencies) - 1, int(round(0.95 * (len(latencies) - 1)))))
        p95 = int(latencies[idx95])
    else:
        p50 = 0
        p95 = 0

    cats: dict[str, list[dict[str, Any]]] = {}
    for row in scenarios:
        cats.setdefault(str(row.get("category")), []).append(row)
    by_cat = {
        k: (sum(1 for r in rows if r.get("status") == "pass") / len(rows) if rows else 0.0)
        for k, rows in cats.items()
    }
    without_known = [x for x in scenarios if not str(x.get("known_issue_reference") or "").strip()]
    pass_without_known = sum(1 for x in without_known if x.get("status") == "pass")
    pass_rate_excluding_known = (pass_without_known / len(without_known)) if without_known else 0.0
    return {
        "pass_rate": (pass_count / n) if n else 0.0,
        "pass_rate_excluding_known_issues": pass_rate_excluding_known,
        "pass_rate_by_category": by_cat,
        "p50_latency_ms": p50,
        "p95_latency_ms": p95,
        "total_llm_calls": sum(int(x.get("metrics", {}).get("llm_calls", {}).get("total", 0)) for x in scenarios),
        "errors": sum(1 for x in scenarios if x.get("status") == "error"),
    }


def run_eval(*, selected_scenarios: list[Scenario], out_dir: Path, model_id: str) -> Path:
    started = datetime.now(timezone.utc)
    run_id = str(uuid.uuid4())
    timestamp = started.strftime("%Y%m%dT%H%M%SZ")
    commit_sha = _git_sha()
    out_dir.mkdir(parents=True, exist_ok=True)
    traces_dir = out_dir / "traces" / run_id
    traces_dir.mkdir(parents=True, exist_ok=True)
    runtime_data_root = out_dir / "_runtime_data" / run_id
    runtime_data_root.mkdir(parents=True, exist_ok=True)

    grouped: dict[str, list[Scenario]] = {}
    for s in selected_scenarios:
        grouped.setdefault(s.persona_id, []).append(s)

    preflight_ok, preflight_error = _llm_preflight(model_id)
    if not preflight_ok:
        raise RuntimeError(preflight_error or "llm_preflight_failed")
    verify_model_available(model_id, Settings(openai_model=model_id))

    scenario_rows: list[dict[str, Any]] = []
    for persona_id, scenarios in grouped.items():
        _seed_persona_context(persona_id=persona_id, model_id=model_id, runtime_data_root=runtime_data_root)
        for scenario in scenarios:
            errors: list[str] = []
            try:
                with count_llm_calls() as calls:
                    results = replay_scenario(scenario, model_id=model_id)
            except Exception:
                results = []
                errors = [traceback.format_exc()]
                calls = {}

            errors.extend([r.error for r in results if r.error])
            total_calls, first_try_calls, retry_calls, by_stage_calls = _counter_to_stage_calls(dict(calls))
            retrieval = score_retrieval(scenario, results)
            coverage = score_coverage(scenario, results)
            recommendation = score_recommendation(scenario, results)
            latency = score_latency(scenario, results)
            safety = _evaluate_safety(scenario, results)
            llm_calls = {
                "total": total_calls,
                "first_try": first_try_calls,
                "retries": retry_calls,
                "by_stage": by_stage_calls,
                "budget": int(scenario.metadata.llm_call_count_budget),
                "within_budget": total_calls <= int(scenario.metadata.llm_call_count_budget),
            }

            trace_obj = next((r.decision_trace for r in reversed(results) if r.decision_trace is not None), None)
            degraded_stages = detect_silent_degradation(trace_obj, model_id)
            if degraded_stages:
                errors.append(f"silent_degradation: stages={degraded_stages}")

            metrics = {
                "retrieval": retrieval,
                "coverage": coverage,
                "recommendation": recommendation,
                "latency": latency,
                "safety": safety,
                "llm_calls": llm_calls,
                "degraded_stages": degraded_stages,
            }
            status = _scenario_status(
                metrics,
                errors,
                known_backend_issue=scenario.expected.known_backend_issue,
            )
            known_issue_reference = None
            if status != "pass" and scenario.expected.known_backend_issue:
                known_issue_reference = scenario.expected.known_backend_issue

            trace_path: str | None = None
            trace_id: str | None = None
            if trace_obj is not None:
                trace_id = trace_obj.decision_id
                trace_file = traces_dir / f"{scenario.id}.json"
                trace_file.write_text(trace_obj.model_dump_json(indent=2), encoding="utf-8")
                trace_path = str(trace_file)

            scenario_rows.append(
                {
                    "scenario_id": scenario.id,
                    "category": scenario.category,
                    "persona_id": scenario.persona_id,
                    "status": status,
                    "errors": errors,
                    "known_issue_reference": known_issue_reference,
                    "metrics": metrics,
                    "raw": {
                        "decision_trace_id": trace_id,
                        "decision_trace_path": trace_path,
                        "system_outputs_per_turn": [r.system_output for r in results],
                    },
                }
            )

    duration_s = round((datetime.now(timezone.utc) - started).total_seconds(), 3)
    report = {
        "run_id": run_id,
        "commit_sha": commit_sha,
        "timestamp": _utc_now_iso(),
        "model_id": model_id,
        "judge_model_id": None,
        "metric_policy": {
            "coverage": "informational_only_phase_1",
            "reason": (
                "LLM output exhibits high lexical variance across runs; "
                "semantic matching deferred to Phase 2 with LLM-as-judge"
            ),
        },
        "total_llm_calls": sum(int(x["metrics"]["llm_calls"]["total"]) for x in scenario_rows),
        "duration_seconds": duration_s,
        "scenarios": scenario_rows,
        "aggregate": _aggregate(scenario_rows),
    }
    out_path = out_dir / f"eval-{commit_sha}-{timestamp}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return out_path


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Run eval scenarios and write JSON report.")
    p.add_argument("--scenarios", required=True, help="all | <id> | comma-separated ids/prefixes")
    p.add_argument("--out", default="tests/eval/reports/", help="Report output directory")
    p.add_argument("--model", default=None, help="Model id override")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    model_id = (args.model or os.getenv("EVAL_MODEL_ID") or "gpt-4o-mini").strip()
    all_scenarios = _load_scenarios()
    selected = _resolve_scenarios(args.scenarios, all_scenarios)
    try:
        out_path = run_eval(selected_scenarios=selected, out_dir=Path(args.out), model_id=model_id)
        print(str(out_path))
        return 0
    except Exception as exc:
        print(f"eval run failed: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
