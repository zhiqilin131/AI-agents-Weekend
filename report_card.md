# Resilience Report Card

- Scenario openai=5xx tavily=none linear_mcp=none: status=ok, complete=True, degraded=2
- Scenario openai=429 tavily=none linear_mcp=none: status=ok, complete=True, degraded=2
- Scenario openai=none tavily=outage linear_mcp=none: status=ok, complete=True, degraded=2
- Scenario openai=none tavily=none linear_mcp=outage: status=ok, complete=True, degraded=3

## Raw

```json
[
  {
    "status": "ok",
    "version": "0.1.0",
    "api": "foresight-x",
    "report_card": {
      "p0_slo": "No uncaught 500 during provider outages in decision paths",
      "p1_slo": "Graceful degradation with user-visible warning",
      "fallback_completion_rate": 0.5,
      "fallback_mode_rate": 0.5,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-14T00:25:31Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 1.0,
          "ok_total": 1.0,
          "error_total": 0.0,
          "brownout_total": 0.0,
          "last_latency_ms": 1.0
        },
        "openai": {
          "calls_total": 4.0,
          "ok_total": 2.0,
          "error_total": 2.0,
          "brownout_total": 0.0,
          "last_latency_ms": 2603.202541999053
        }
      },
      "circuit_breakers": {},
      "chaos_modes": {
        "openai": "5xx",
        "tavily": "",
        "linear_mcp": ""
      }
    },
    "scenario": {
      "openai": "5xx",
      "tavily": "none",
      "linear_mcp": "none"
    },
    "chaos_assertions": {
      "sse_complete": true,
      "decision_id": "5e92732c-e7a9-4b05-9d93-a82aa882e205",
      "degraded_events_seen": 2,
      "trace_degradations_seen": 1,
      "provider_per_stage_keys": [
        "enhance",
        "finalize"
      ],
      "never_500": true
    }
  },
  {
    "status": "ok",
    "version": "0.1.0",
    "api": "foresight-x",
    "report_card": {
      "p0_slo": "No uncaught 500 during provider outages in decision paths",
      "p1_slo": "Graceful degradation with user-visible warning",
      "fallback_completion_rate": 0.5,
      "fallback_mode_rate": 0.5,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-14T00:25:40Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 2.0,
          "ok_total": 2.0,
          "error_total": 0.0,
          "brownout_total": 0.0,
          "last_latency_ms": 1.0
        },
        "openai": {
          "calls_total": 8.0,
          "ok_total": 4.0,
          "error_total": 4.0,
          "brownout_total": 0.0,
          "last_latency_ms": 3152.4089579907013
        }
      },
      "circuit_breakers": {},
      "chaos_modes": {
        "openai": "429",
        "tavily": "",
        "linear_mcp": ""
      }
    },
    "scenario": {
      "openai": "429",
      "tavily": "none",
      "linear_mcp": "none"
    },
    "chaos_assertions": {
      "sse_complete": true,
      "decision_id": "4ca239c4-06c3-41e6-a714-e866ae09d011",
      "degraded_events_seen": 2,
      "trace_degradations_seen": 1,
      "provider_per_stage_keys": [
        "enhance",
        "finalize"
      ],
      "never_500": true
    }
  },
  {
    "status": "ok",
    "version": "0.1.0",
    "api": "foresight-x",
    "report_card": {
      "p0_slo": "No uncaught 500 during provider outages in decision paths",
      "p1_slo": "Graceful degradation with user-visible warning",
      "fallback_completion_rate": 0.5,
      "fallback_mode_rate": 0.5,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-14T00:25:47Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 3.0,
          "ok_total": 3.0,
          "error_total": 0.0,
          "brownout_total": 0.0,
          "last_latency_ms": 1.0
        },
        "openai": {
          "calls_total": 12.0,
          "ok_total": 6.0,
          "error_total": 6.0,
          "brownout_total": 0.0,
          "last_latency_ms": 3401.1355830007233
        }
      },
      "circuit_breakers": {},
      "chaos_modes": {
        "openai": "",
        "tavily": "outage",
        "linear_mcp": ""
      }
    },
    "scenario": {
      "openai": "none",
      "tavily": "outage",
      "linear_mcp": "none"
    },
    "chaos_assertions": {
      "sse_complete": true,
      "decision_id": "62cb34ae-2c8d-48f0-bd1e-6d42ac829764",
      "degraded_events_seen": 2,
      "trace_degradations_seen": 1,
      "provider_per_stage_keys": [
        "enhance",
        "finalize"
      ],
      "never_500": true
    }
  },
  {
    "status": "ok",
    "version": "0.1.0",
    "api": "foresight-x",
    "report_card": {
      "p0_slo": "No uncaught 500 during provider outages in decision paths",
      "p1_slo": "Graceful degradation with user-visible warning",
      "fallback_completion_rate": 0.5,
      "fallback_mode_rate": 0.5,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-14T00:25:56Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 4.0,
          "ok_total": 3.0,
          "error_total": 1.0,
          "brownout_total": 0.0,
          "last_latency_ms": 0.0
        },
        "openai": {
          "calls_total": 16.0,
          "ok_total": 8.0,
          "error_total": 8.0,
          "brownout_total": 0.0,
          "last_latency_ms": 4261.724500000128
        }
      },
      "circuit_breakers": {},
      "chaos_modes": {
        "openai": "",
        "tavily": "",
        "linear_mcp": "outage"
      }
    },
    "scenario": {
      "openai": "none",
      "tavily": "none",
      "linear_mcp": "outage"
    },
    "chaos_assertions": {
      "sse_complete": true,
      "decision_id": "4fc23e27-6ee5-48e4-9c8c-721ad20b5e28",
      "degraded_events_seen": 3,
      "trace_degradations_seen": 1,
      "provider_per_stage_keys": [
        "enhance",
        "finalize"
      ],
      "never_500": true
    }
  }
]
```