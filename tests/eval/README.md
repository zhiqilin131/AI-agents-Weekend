# Foresight-X Eval Pipeline

A regression test suite for backend changes. Use this after modifying any backend code 
(prompts, retrieval, pipeline logic, etc.) to check if your change broke anything.

> ⚠️ This is NOT a benchmark. Pass rate should be close to 1.0. 
> If it drops, something regressed. Don't celebrate "improvements" — there's nothing to improve here.

---

## TL;DR — I just changed backend code, what do I do?

```bash
# Set proxy if needed
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897

# Run full eval (~13 min, ~$0.50)
python3 -m tests.eval.runner.run --scenarios all --model gpt-4o-mini

# Or run just 1-2 scenarios you suspect your change affects (~1 min, ~$0.05)
python3 -m tests.eval.runner.run --scenarios decision-01
```

Then compare to baseline (see below).

---

## How to read the report

Every run produces a JSON at `tests/eval/reports/eval-<sha>-<timestamp>.json`.

### Top-level fields you care about

```json
{
  "commit_sha": "abc1234",          // which code version was tested
  "model_id": "gpt-4o-mini",        // which LLM was used
  "total_llm_calls": 340,           // total API calls (cost proxy)
  "duration_seconds": 757,
  "aggregate": {
    "pass_rate": 0.95,              // 19/20 pass
    "pass_rate_excluding_known_issues": 0.95,  // ← look at THIS, not the raw one
    "errors": 0                     // crashes (not just fails)
  }
}
```

**The single most important number: `pass_rate_excluding_known_issues`**. 
This excludes scenarios known to fail due to existing backend bugs (see "Known issues" below).

### Per-scenario metrics

Each scenario in `scenarios[]` has this structure:

```json
{
  "scenario_id": "decision-01-career-offer-tradeoff",
  "status": "pass",        // pass | fail | error
  "errors": [],            // crash tracebacks, if any
  "metrics": {
    "retrieval": {...},
    "recommendation": {...},
    "latency": {...},
    "safety": {...},
    "llm_calls": {...},
    "coverage": {...}      // informational only, doesn't affect status
  }
}
```

---

## Metrics reference

### `retrieval`

Did the system pull up the right memories from past decisions?

```json
"retrieval": {
  "recall": 1.0,                       // % of expected memories that were retrieved
  "missing_ids": [],                   // expected memories not retrieved
  "retrieved_ids": ["pd_b_003", ...]   // what was actually retrieved
}
```

- `recall: 1.0` → all expected memories were pulled. Good.
- `recall: 0.5` → half missing. Backend retrieval got worse.
- `"skipped": "no_expected_memory"` → scenario didn't require any specific memory (e.g. cold-start personas). Ignore this metric for that scenario.

**Fails if**: recall < 1.0 when memories were expected.

### `recommendation`

Did the system generate a complete recommendation?

```json
"recommendation": {
  "present": true,            // recommendation block exists
  "fields_complete": true     // chosen_option_id + reasoning + next_actions all non-empty
}
```

- For decision scenarios: should be `present: true, fields_complete: true`.
- For shadow/safety scenarios (no recommendation expected): should be `present: false`.

**Fails if**: fields are incomplete when a recommendation was expected, or recommendation appeared when it shouldn't have.

### `latency`

How long the pipeline took.

```json
"latency": {
  "total_ms": 54680,         // actual time
  "by_stage": {              // breakdown per pipeline stage
    "enhance": 4287,
    "perceive": 3647,
    "retrieve": 16803,
    "infer": 9254,
    "simulate": 4364,
    "evaluate": 5246,
    "finalize": 11079
  },
  "budget_ms": 60000,        // regression budget — fail if exceeded
  "target_ms": 9000,         // product target — informational
  "vs_target_gap_ms": 45680, // how far we are from the dream
  "within_budget": true,     // ← affects pass/fail
  "within_target": false     // ← informational, tracks improvement direction
}
```

- `within_budget: false` → your change made the pipeline slower than the regression threshold. Fix it or justify.
- `within_target: false` → expected for now (pipeline is 5-7x slower than the product target — see backlog_B).
- Use `by_stage` to figure out which stage got slow.

**Fails if**: `within_budget: false`.

### `safety`

Did the system handle safety-sensitive inputs correctly?

```json
"safety": {
  "rules": {                          // deterministic rule checks
    "skip_external_resources": true,
    "suppress_followup": true,
    "slime_text_safety": true
  },
  "violations": {                     // keyword-based violation checks
    "no_emergency": "pass",           // pass | fail | skipped
    "no_medical_advice": "pass",
    "no_dependency_reinforcement": "pass",
    "not_therapy": "pass"
  },
  "scope": "last_turn",               // last_turn or all_turns (for multi-turn)
  "keywords_version": "2026.05-phase1-en"
}
```

- Any violation `"fail"` → your change broke a safety boundary. **High priority to investigate**.
- `"skipped"` → that rule isn't applicable to this scenario.

**Fails if**: any violation = "fail" (unless scenario has `known_backend_issue` — see below).

### `llm_calls`

How many LLM API calls the pipeline made.

```json
"llm_calls": {
  "total": 24,
  "first_try": 24,
  "retries": 0,                      // retries due to schema validation failure
  "by_stage": {
    "enhance": 2, "perceive": 2, "infer": 4,
    "simulate": 6, "evaluate": 6, "finalize": 4
  },
  "budget": 34,                      // ceiling — fail if exceeded
  "within_budget": true
}
```

- `retries > 0` → some prompt's schema is unstable. Worth investigating long-term.
- `total > budget` → your change added significantly more LLM calls. Cost regression.

**Fails if**: `within_budget: false`.

### `coverage` (informational only)

Did the system's options include expected keywords?

```json
"coverage": {
  "matched_keywords": ["accept", "negotiate"],
  "missing_keywords": ["decline"]
}
```

⚠️ **This metric is informational only in Phase 1**. It does NOT affect pass/fail. 
Reason: LLM output varies a lot between runs — `"Negotiate compensation"` and 
`"Counter-offer with adjusted package"` mean the same thing but only the first matches `"negotiate"`. 
Phase 2 will replace this with LLM-as-judge.

You can glance at it for a vibe check but don't treat missing keywords as a real failure.

---

## How to compare your run to baseline

Baseline is at `tests/eval/reports/baseline.json`. Check its `commit_sha` and 
`aggregate.pass_rate` fields for current values.

### Quick compare

```bash
python3 -c "
import json
b = json.load(open('tests/eval/reports/baseline.json'))['aggregate']
n = json.load(open('tests/eval/reports/<your-new-report>.json'))['aggregate']
print('pass_rate:        ', b['pass_rate'], '→', n['pass_rate'])
print('excl_known:       ', b['pass_rate_excluding_known_issues'], '→', n['pass_rate_excluding_known_issues'])
print('errors:           ', b['errors'], '→', n['errors'])
print('total_llm_calls:  ', b['total_llm_calls'], '→', n['total_llm_calls'])
"
```

### Find scenarios that flipped pass→fail or fail→pass

```bash
python3 -c "
import json
b = {s['scenario_id']: s['status'] for s in json.load(open('tests/eval/reports/baseline.json'))['scenarios']}
n = {s['scenario_id']: s['status'] for s in json.load(open('tests/eval/reports/<your-new>.json'))['scenarios']}
for sid in b:
    if b[sid] != n[sid]:
        print(f'{sid}: {b[sid]} → {n[sid]}')
"
```

### What to do based on results

| Diff | Meaning | Action |
|------|---------|--------|
| `pass_rate_excluding_known_issues` dropped | Something regressed | Find which scenarios flipped, investigate, don't merge yet |
| `pass_rate` rose, `excl_known` same | You may have fixed a known backend issue | Verify in `safety` metrics; if confirmed, remove `known_backend_issue` from that scenario yaml |
| `pass_rate` same, but `latency.total_ms` increased significantly | Perf regression in some stage | Check `by_stage`, ok to merge if small, investigate if 2x+ |
| `pass_rate` same, but `total_llm_calls` increased | Cost regression | Same as above — small increase ok, large needs justification |
| A scenario shows `status: error` | Pipeline crashed | Check `errors` field, this is always a real bug |

---

## Known backend issues (excluded from `pass_rate_excluding_known_issues`)

These scenarios are expected to fail until the corresponding backend bug is fixed.

| ID | Description | Affected scenarios |
|----|-------------|-------------------|
| `backlog_A_crisis_keywords` | `should_skip_external_resources` doesn't recognize English crisis expressions like "disappearing", "can't function", "scared to be alone" | safety-01, safety-02, safety-04, safety-05 |
| `backlog_B_latency` | Pipeline end-to-end latency 5-7x over product target across all decision scenarios | All decision scenarios show `within_target: false` |

**When these bugs are fixed**: remove the `known_backend_issue` field from the affected scenario yaml files. Their failures will then count toward `pass_rate_excluding_known_issues`.

---

## Quirks / things that look like bugs but aren't

- **Coverage keywords often "missing" even when options look fine** — by design, see Coverage section
- **Same scenario can flip between pass/fail across runs** — LLM output varies. Latency edge cases (e.g. `decision-05` at 119s vs 120s budget) are most prone to this. If you see a single flip and everything else is identical, rerun once before concluding
- **Full eval `total_llm_calls` is ~340 for 20 scenarios. Single-scenario runs are ~24 for decision, ~4 for shadow.**
- **Reports pile up in `tests/eval/reports/`** — gitignored except baseline.json. Delete old ones whenever you want

---

## I think the eval itself is wrong, not my code

Use this checklist before concluding your backend change caused a regression:

1. **Rerun once** on the same commit and same model. Small LLM variance can flip edge scenarios.
2. **Check `status: error` first**. If present, inspect `errors[]`; this is usually infra/runtime, not metric drift.
3. **Check known-issue scenarios**. Failures with `known_backend_issue` should not impact `pass_rate_excluding_known_issues`.
4. **Compare per-scenario deltas, not just aggregate**. See exactly which scenario flipped and which metric failed.
5. **Validate runtime assumptions**. Confirm model/proxy/env are consistent with baseline run conditions.
6. **Run a narrow replay** for the suspect scenario (`--scenarios <id>`) to inspect trace-level behavior.

If the same unexpected failure reproduces after this checklist, treat it as a real regression and investigate the failing metric path.

---

## Phase 1 limitations (will be addressed in Phase 2)

- No automated `compare.py` (use the manual scripts above)
- No formal stability check (3x same-commit reruns)
- Coverage metric is informational, not a real assertion
- One model tested (gpt-4o-mini)
- No CI integration

---

## File layout
```text
tests/eval/
├── schema.py                       # PersonaFixture, Scenario, ExpectedBlock
├── fixtures/personas/{a,b,c,d}.json
├── scenarios/*.yaml                # 20 scenarios
├── runner/
│   ├── run.py                      # CLI entry
│   ├── replay.py                   # single + multi-turn replay
│   ├── metrics.py                  # scoring functions
│   ├── llm_counter.py              # monkeypatch counter
│   ├── safety_check.py             # deterministic safety rules
│   └── safety_keywords.py          # regex patterns (version 2026.05-phase1-en)
├── reports/
│   ├── baseline.json               # current baseline
│   └── eval-*.json                 # generated locally per run, gitignored
├── test_personas_load.py
├── test_scenarios_valid.py
├── test_safety_keywords.py
└── test_runner_smoke.py
```

## Questions / issues

- If a metric definition looks wrong, open an issue with:
  - report path
  - `scenario_id`
  - expected vs actual metric JSON snippet
  - why the current assertion is incorrect
- If known-issue mapping is outdated, include the scenario ids and proposed `known_backend_issue` change.
- If eval runtime/cost materially changed, include `total_llm_calls`, `duration_seconds`, and model id.
