# Resilience Report Card

- Scenario openai=5xx tavily=none linear_mcp=none: status=ok, complete=True, degraded=1
- Scenario openai=429 tavily=none linear_mcp=none: status=ok, complete=True, degraded=1
- Scenario openai=none tavily=outage linear_mcp=none: status=ok, complete=True, degraded=1
- Scenario openai=none tavily=none linear_mcp=outage: status=ok, complete=True, degraded=2

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
      "fallback_completion_rate": 1.0,
      "fallback_mode_rate": 0.0,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-13T01:12:33Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 1.0,
          "ok_total": 1.0,
          "error_total": 0.0,
          "brownout_total": 0.0,
          "last_latency_ms": 1.0
        }
      },
      "circuit_breakers": {
        "openai": {
          "state": "closed",
          "failures": 0,
          "open_until_epoch": 0.0
        }
      },
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
      "decision_id": "842168c9-7d9b-41f8-9d36-dd8abbcf3c4e",
      "degraded_events_seen": 1,
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
      "fallback_completion_rate": 1.0,
      "fallback_mode_rate": 0.0,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-13T01:14:13Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 2.0,
          "ok_total": 2.0,
          "error_total": 0.0,
          "brownout_total": 0.0,
          "last_latency_ms": 1.0
        }
      },
      "circuit_breakers": {
        "openai": {
          "state": "closed",
          "failures": 0,
          "open_until_epoch": 0.0
        }
      },
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
      "decision_id": "e3983e6d-adee-4a2b-a959-63c04043498f",
      "degraded_events_seen": 1,
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
      "fallback_completion_rate": 0.0,
      "fallback_mode_rate": 1.0,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-13T01:16:40Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 3.0,
          "ok_total": 3.0,
          "error_total": 0.0,
          "brownout_total": 0.0,
          "last_latency_ms": 1.0
        },
        "openai": {
          "calls_total": 4.0,
          "ok_total": 0.0,
          "error_total": 4.0,
          "brownout_total": 4.0,
          "last_latency_ms": 11902.85241600941
        }
      },
      "circuit_breakers": {
        "openai": {
          "state": "open",
          "failures": 4,
          "open_until_epoch": 1778635030.454711
        }
      },
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
      "decision_id": "27c18a8f-5811-4eba-81c1-c5c81e3181b5",
      "degraded_events_seen": 1,
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
      "fallback_completion_rate": 0.0,
      "fallback_mode_rate": 1.0,
      "mttr_seconds_estimate": 30
    },
    "runtime": {
      "status": "ok",
      "generated_at": "2026-05-13T01:18:42Z",
      "providers": {
        "linear_mcp": {
          "calls_total": 4.0,
          "ok_total": 3.0,
          "error_total": 1.0,
          "brownout_total": 0.0,
          "last_latency_ms": 0.0
        },
        "openai": {
          "calls_total": 6.0,
          "ok_total": 0.0,
          "error_total": 6.0,
          "brownout_total": 6.0,
          "last_latency_ms": 12428.173415988567
        }
      },
      "circuit_breakers": {
        "openai": {
          "state": "open",
          "failures": 6,
          "open_until_epoch": 1778635151.925635
        }
      },
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
      "decision_id": "6963ef97-bcc2-497e-ae91-ba18be2c3353",
      "degraded_events_seen": 2,
      "never_500": true
    }
  }
]
```