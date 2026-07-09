# Cost-Friendly Quality Benchmark

Manual-only benchmark for Foresight X. **Not wired to CI.**

**Full developer playbook:** [DEVELOPER.md](./DEVELOPER.md)  
**Tier manifest:** [manifest.yaml](./manifest.yaml)

## Quick commands

```bash
make quality-help              # all targets
make quality-preflight         # F0, $0 — run on every relevant change
make quality-e2e-smoke CONFIRM=1   # P0, ~$0.02 — before merge
make quality-e2e-core CONFIRM=1    # P1, ~$0.36 — weekly
make quality-weekly            # F0 → estimate → smoke
```

Or: `./scripts/quality_benchmark.sh help`

## Suites

| Tier | Suite | Cost |
|------|-------|------|
| F0 | `free` | $0 |
| F1 | `graph` / `mcda` / `report` / `memory` | $0 |
| P0 | `e2e-smoke` | ~$0.02 |
| P1 | `e2e-core` | ~$0.36 |
| P2 | `e2e-all` | ~$0.50 |

## Gate

Paid runs exit `0` when **gate PASS**: mean DGS ≥ 0.72, per-scenario ≥ 0.55, zero errors, safety + no silent degradation + no severe latency/LLM-call overrun.

## Optional (opt-in, $0 unless enabled)

`--repeat N` (median dgs + majority vote across N runs), `--model a,b` (multi-model comparison), `--llm-judge` (semantic safety judge on top of regex checks). See [DEVELOPER.md](./DEVELOPER.md#optional-features-all-opt-in-0-unless-enabled).

See [DEVELOPER.md](./DEVELOPER.md) for interpreting reports, adding cases, and the industrial cadence.
