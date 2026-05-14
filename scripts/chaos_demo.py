"""Chaos demo runner: asserts successful SSE decision traces under injected faults."""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from foresight_x.ui.api_server import app


def _parse_sse_payload(text: str) -> list[dict]:
    out: list[dict] = []
    blocks = text.split("\n\n")
    for b in blocks:
        lines = [ln.strip() for ln in b.splitlines() if ln.strip()]
        if not lines:
            continue
        data_lines = [ln[5:] for ln in lines if ln.startswith("data:")]
        if not data_lines:
            continue
        raw = "\n".join(data_lines).strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except Exception:
            continue
    return out


def _run_probe(mode_openai: str, mode_tavily: str, mode_linear: str) -> dict:
    if mode_openai:
        os.environ["CHAOS_OPENAI_MODE"] = mode_openai
    else:
        os.environ.pop("CHAOS_OPENAI_MODE", None)
    if mode_tavily:
        os.environ["CHAOS_TAVILY_MODE"] = mode_tavily
    else:
        os.environ.pop("CHAOS_TAVILY_MODE", None)
    if mode_linear:
        os.environ["CHAOS_LINEAR_MCP_MODE"] = mode_linear
    else:
        os.environ.pop("CHAOS_LINEAR_MCP_MODE", None)

    c = TestClient(app)
    traces_dir = Path("data/traces")
    seed_path = traces_dir / "pipe-test-1.json"
    if not seed_path.exists():
        candidates = sorted(traces_dir.glob("*.json"))
        if not candidates:
            raise RuntimeError("no seed trace available under data/traces for stage resume demo")
        seed_path = candidates[0]
    seed_trace = json.loads(seed_path.read_text(encoding="utf-8"))
    stream_res = c.post(
        "/api/run/stream",
        json={
            "raw_input": "I need to decide whether to accept a new role this month.",
            "preserve_raw_input": True,
            "resume_from_stage": "finalize",
            "resume_partial": seed_trace,
        },
    )
    if stream_res.status_code != 200:
        raise RuntimeError(f"run stream failed: {stream_res.status_code} {stream_res.text}")
    events = _parse_sse_payload(stream_res.text)
    complete = next((e for e in events if e.get("event") == "complete"), None)
    if not complete:
        raise RuntimeError("no complete event in SSE stream")
    trace = complete.get("trace")
    if not isinstance(trace, dict) or not trace.get("decision_id"):
        raise RuntimeError("complete event missing decision trace")
    degradations = trace.get("degradations")
    if not isinstance(degradations, list):
        raise RuntimeError("trace missing degradations list")
    runtime = trace.get("runtime")
    if not isinstance(runtime, dict):
        raise RuntimeError("trace missing runtime metadata")
    provider_per_stage = runtime.get("provider_per_stage")
    if not isinstance(provider_per_stage, dict) or not provider_per_stage:
        raise RuntimeError("trace runtime.provider_per_stage is empty")
    if (mode_openai or mode_tavily or mode_linear) and not degradations:
        raise RuntimeError("chaos scenario produced empty trace.degradations")
    degraded_events = [e for e in events if e.get("event") == "degraded"]
    if (mode_openai or mode_tavily or mode_linear) and not degraded_events:
        raise RuntimeError("fault scenario produced no degraded event")

    h = c.get("/api/health/resilience")
    if h.status_code != 200:
        raise RuntimeError(f"resilience health probe failed: {h.status_code} {h.text}")
    body = h.json()
    body["scenario"] = {
        "openai": mode_openai or "none",
        "tavily": mode_tavily or "none",
        "linear_mcp": mode_linear or "none",
    }
    body["chaos_assertions"] = {
        "sse_complete": True,
        "decision_id": trace.get("decision_id"),
        "degraded_events_seen": len(degraded_events),
        "trace_degradations_seen": len(degradations),
        "provider_per_stage_keys": sorted(list(provider_per_stage.keys())),
        "never_500": stream_res.status_code != 500,
    }
    return body


def main() -> int:
    scenarios = [
        ("5xx", "", ""),
        ("429", "", ""),
        ("", "outage", ""),
        ("", "", "outage"),
    ]
    out: list[dict] = []
    for o, t, l in scenarios:
        out.append(_run_probe(o, t, l))
    target = Path("report_card.md")
    lines = ["# Resilience Report Card", ""]
    for row in out:
        sc = row.get("scenario", {})
        lines.append(
            f"- Scenario openai={sc.get('openai')} tavily={sc.get('tavily')} linear_mcp={sc.get('linear_mcp')}: status={row.get('status')}, complete={row.get('chaos_assertions', {}).get('sse_complete')}, degraded={row.get('chaos_assertions', {}).get('degraded_events_seen')}"
        )
    lines.append("")
    lines.append("## Raw")
    lines.append("")
    lines.append("```json")
    lines.append(json.dumps(out, ensure_ascii=False, indent=2))
    lines.append("```")
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
