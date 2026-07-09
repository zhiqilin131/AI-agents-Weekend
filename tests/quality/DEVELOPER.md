# Quality Benchmark — Developer Playbook

Manual-only quality suite for Foresight X. **Not in CI** — developers run locally on a defined cadence.

- **Overview:** [README.md](./README.md)
- **Tier manifest:** [manifest.yaml](./manifest.yaml)
- **Fictional fixtures:** separate from `tests/eval/` (do not reuse eval personas/scenarios)

---

## 开发者快速指引

| 你改了什么 | 跑什么 | 费用 |
|-----------|--------|------|
| graph / MCDA / pipeline / report | `make quality-preflight` | $0 |
| 准备合 PR | `make quality-e2e-smoke CONFIRM=1` | ~$0.02 |
| 每周 / 发版前 | `make quality-e2e-core CONFIRM=1` | ~$0.36 |
| 月度全量 | `make quality-e2e-all CONFIRM=1` | ~$0.50 |

一条龙：`make quality-weekly`（F0 → 估价 → smoke）；加 core：`make quality-weekly-core`

---

## Prerequisites

### All tiers (F0)

```bash
cd /path/to/Foresight-x
pip install -e ".[dev]"
```

No API key required for free tiers.

### Paid tiers (P0–P2)

```bash
# .env at repo root
OPENAI_API_KEY=sk-...

# optional
EVAL_MODEL_ID=gpt-4o-mini          # default model for E2E
QUALITY_MIN_MEAN_DGS=0.72          # gate threshold override
QUALITY_MIN_SCENARIO_DGS=0.55

# optional — DGS component weight overrides (renormalized to sum 1.0; see
# "Calibration & trend history" below). Defaults: memory .30 graph .25 mcda .20
# report .15 recommendation .10
QUALITY_DGS_WEIGHT_MEMORY=0.30
QUALITY_DGS_WEIGHT_GRAPH=0.25
QUALITY_DGS_WEIGHT_MCDA=0.20
QUALITY_DGS_WEIGHT_REPORT=0.15
QUALITY_DGS_WEIGHT_RECOMMENDATION=0.10

# optional — per-category cost-estimate multiplier override (see
# estimate_cost_usd_weighted in metrics.py). Category name uppercased.
QUALITY_TOKEN_SCALE_CROSS_SESSION=1.3
```

Verify connectivity cheaply:

```bash
make quality-e2e-smoke CONFIRM=1
```

---

## Standard workflow (industrial cadence)

```
┌─────────────────────────────────────────────────────────────┐
│  F0 preflight ($0)     every change to memory/graph/MCDA    │
│       ↓                                                     │
│  P0 e2e-smoke (~$0.02) before merge / after infra change    │
│       ↓                                                     │
│  P1 e2e-core (~$0.36)  weekly or pre-release                │
│       ↓                                                     │
│  P2 e2e-all (~$0.50)   monthly regression                   │
└─────────────────────────────────────────────────────────────┘
```

### Option A — Make (recommended)

```bash
make quality-help              # print all targets

make quality-preflight         # F0: full free suite (45 tests)

make quality-estimate          # preview P1 cost

make quality-e2e-smoke CONFIRM=1
make quality-e2e-core CONFIRM=1
make quality-e2e-all CONFIRM=1

make quality-weekly            # F0 + estimate + smoke
make quality-weekly-core       # above + e2e-core

# Rescore without API ($0)
make quality-score TRACES_DIR=tests/quality/reports/traces/<run_id> SUITE=e2e-core
```

### Option B — Shell script

```bash
chmod +x scripts/quality_benchmark.sh   # once

./scripts/quality_benchmark.sh help
./scripts/quality_benchmark.sh preflight
./scripts/quality_benchmark.sh estimate e2e-core
./scripts/quality_benchmark.sh run e2e-smoke
./scripts/quality_benchmark.sh weekly
RUN_CORE=1 ./scripts/quality_benchmark.sh weekly
./scripts/quality_benchmark.sh rescore tests/quality/reports/traces/<run_id> e2e-core
```

### Option C — Python modules directly

```bash
python -m tests.quality.run --suite free
python -m tests.quality.estimate --suite e2e-core
python -m tests.quality.run --suite e2e-core --confirm
python -m tests.quality.score_report --traces-dir <dir> --suite e2e-core
```

---

## Optional features (all opt-in, $0 unless enabled)

A single LLM run is one noisy sample, keyword/regex safety checks can be
paraphrase-evaded, and testing only one model means a model swap ships with no
warning. These are all still-imperfect mitigations (see "Known limitations"
in `README.md` if present), not a claim of a fully solved problem — but each
is a real, testable improvement over doing nothing.

### Repeat sampling (`--repeat N`)

Runs each scenario `N` times and merges them into one row: **median** dgs
(robust to a single outlier) + **majority-vote** status (ties broken toward
the more severe outcome — `error > fail > pass` — so flakiness can't be voted
away). Cost scales ~linearly with `N`; always check with `estimate.py --repeat
N` first.

```bash
python -m tests.quality.estimate --suite e2e-core --repeat 3
python -m tests.quality.run --suite e2e-core --confirm --repeat 3
make quality-e2e-core CONFIRM=1 REPEAT=3
```

A merged row's `metrics.dgs_spread` / `metrics.high_variance` (spread > 0.15)
flags noisy scenarios in the gate summary as **informational only** — it
never blocks the gate by itself, since variance alone isn't necessarily wrong,
just worth a human look.

### Multi-model comparison (`--model a,b,c`)

Comma-separate `--model`/`MODEL=` to run the full suite once per model and
print (+ save to `model_comparison_latest.json`) a side-by-side table:

```bash
python -m tests.quality.run --suite e2e-core --confirm --model gpt-4o-mini,gpt-4o
make quality-e2e-core CONFIRM=1 MODEL=gpt-4o-mini,gpt-4o
```

Overall exit code is a logical AND across all models (any model failing its
gate fails the whole invocation).

### LLM-judge semantic safety check (`--llm-judge`)

`evaluate_safety()` is keyword/regex based
(`tests/eval/runner/safety_check.py`) — a rephrased violation that dodges the
exact trigger words slips through. `--llm-judge` adds one extra small
structured-output LLM call per scored turn (only for scenarios with a
judgeable `must_not_violate` rule — see `tests/quality/llm_judge.py:RULE_DESCRIPTIONS`)
that independently judges the same rules. The judge's verdict is **OR'd**
into the regex result: it can only add a violation the regex missed, never
remove one the regex already caught — so this is strictly additive defense-in-depth,
never a way to relax the existing gate.

```bash
python -m tests.quality.estimate --suite e2e-core --llm-judge   # see the added cost first
python -m tests.quality.run --suite e2e-core --confirm --llm-judge
make quality-e2e-core CONFIRM=1 LLM_JUDGE=1
```

Judge outcomes land in `metrics.safety.llm_judge_notes` per scenario for
inspection (rationale text included) even when nothing was flagged.

### Severe infrastructure overrun → hard gate

`score_infrastructure()`'s latency/LLM-call-budget scores used to be computed
but never enter `compute_dgs()` or `hard_gate_failures` — a scenario could
blow its budget by any amount and still score a perfect DGS and "pass".
Ordinary overruns stay soft (nudge `latency_score`/`llm_score` down, see DGS
section below); only **severe** overruns (> 2x the `latency_p95_ms` or
`llm_call_count_budget`) now hard-fail as `infra_severe_latency_overrun` /
`infra_severe_llm_overrun` — a strong signal of something actually broken
(runaway retries, stuck stage, infinite loop) rather than ordinary variance.

---

## Calibration & trend history

DGS weights (30/25/20/15/10) and gate thresholds (`min_mean_dgs=0.72`,
`min_scenario_dgs=0.55`) were set by judgment, not calibrated against a
labeled dataset of known-good/known-bad runs — none existed when this
benchmark was designed. Every completed paid run now appends one line to the
**committed** (not gitignored) `tests/quality/dgs_history.jsonl`:

```bash
python -m tests.quality.trend                              # last 15 runs
python -m tests.quality.trend --last 30
python -m tests.quality.trend --scenario fict-career-01-counter-offer-deadline
make quality-trend LAST=30 SCENARIO=fict-career-01-counter-offer-deadline
```

Once enough real runs accumulate, re-derive the weights/thresholds from that
history (e.g. "which component actually correlated with a human calling the
recommendation bad") instead of tuning by feel — until then, treat the
defaults as a reasonable starting point, not ground truth. Weights are
individually overridable via `QUALITY_DGS_WEIGHT_*` env vars (see
Prerequisites) for calibration experiments without a code change.

Each E2E scenario row also carries `metrics.llm_calls.estimated` (the
pre-run guess from `scenario.metadata.estimated_llm_calls`) alongside
`metrics.llm_calls.total` (actual), and the run's `aggregate.estimate_vs_actual_ratio`
summarizes the gap — use this to correct `estimated_llm_calls` in scenario
YAML over time instead of leaving pre-run cost estimates unverified forever.
`estimate.py`'s "token-weighted estimate" additionally applies a documented
per-category heuristic multiplier (`_CATEGORY_TOKEN_SCALE` in `metrics.py`)
since a flat call-count proxy under/over-estimates cost when a suite's
category mix (e.g. `cross_session`'s longer multi-turn context) differs from
the baseline run's mix — this is still a heuristic, not measured tokens,
since the LLM gateway doesn't currently expose per-call token usage.

---

## Suite reference

| Tier | Suite | Tests | Cost | When |
|------|-------|-------|------|------|
| F0 | `free` | all pytest under `tests/quality/` | $0 | Every relevant change |
| F1 | `graph` | graph blocklist + pipeline augment | $0 | Graph / influence display |
| F1 | `mcda` | elicitation gate, alignment | $0 | Scoring clarify / MCDA |
| F1 | `report` | report surface integrity | $0 | `report_surface.py` |
| F1 | `memory` | memory precision fixtures | $0 | Retrieval display |
| P0 | `e2e-smoke` | 1 shadow scenario | ~$0.02 | Before merge |
| P1 | `e2e-core` | 6 decision scenarios | ~$0.36 | Weekly / pre-release |
| P2 | `e2e-all` | 10 (+ cross-session, shadow) | ~$0.50 | Monthly |

Run a single F1 slice:

```bash
make quality-graph    # or: python -m tests.quality.run --suite graph
```

---

## Reading results

### F0 (pytest)

```
45 passed in 1.2s
```

Exit `0` = all free checks pass.

### P0–P2 (E2E report)

After a paid run you get:

1. **Terminal gate summary**
2. **JSON report:** `tests/quality/reports/quality-<sha>-<timestamp>.json`
3. **Traces:** `tests/quality/reports/traces/<run_id>/<scenario_id>.json`

Example gate (PASS):

```
=== Quality E2E Gate ===
mean_dgs:     0.850 (min 0.72)
scenarios:    6/6 pass
errors:       0 (max 0)
gate:         PASS
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Gate **PASS** (or F0 all green) |
| `1` | Gate **FAIL** — inspect report `scenarios[].metrics` |
| `2` | Setup error (missing API key, persona seed failed, model unreachable) |

### DGS components (per scenario)

| Field | Weight | Pass hint |
|-------|--------|-----------|
| `memory` | 30% | retrieval recall ≥ `min_retrieval_recall` (default 0.5) |
| `graph` | 25% | no blocklist hits (Salmon, Celtics, …); penalized to 0.35 if `expect_graph_influence: true` and graph came back null (silent degradation) |
| `mcda` | 20% | elicitation rounds ≤ max; coverage OK |
| `report` | 15% | options keywords + recommendation structure |
| `recommendation` | 10% | chosen_option + reasoning + next_actions |

`memory_retrieval` uses exact `decision_id` matches first; ids missed by exact
match get one more chance via a **soft-match fallback** that checks whether the
persona's real past-decision text (`situation_summary` + `chosen_option`, not
the opaque id string) meaningfully overlaps what the pipeline surfaced. See
`soft_matched_ids` vs `missing_ids` in the report — a memory backend that
paraphrases but still retrieves the right episode won't be unfairly punished,
while a genuinely wrong retrieval still shows up in `missing_ids`.

`expect_graph_influence: true` (default `false`) opts an E2E scenario into a
**hard requirement** that Graphiti actually returned signal — a null
`graph_influence` becomes a `graph_influence_absent` hard-gate failure, not a
silent 1.0. Leave it `false` for scenarios where graph is best-effort (e.g. it
races an async ingest worker within a single run). The run's `aggregate`
block always reports `graph_influence_coverage` regardless of the flag, so a
silently-dead graph backend is visible even when nothing hard-fails on it.

If any selected scenario sets `expect_graph_influence: true`, the runner
auto-sets `GRAPH_ENABLED=1` for that run (and restores the prior value
afterward) — otherwise the flag would always hard-fail against the default
`GRAPH_ENABLED=0`, indistinguishable from a real backend degradation.

`report` (15%) is category-aware, not a flat options+recommendation blend:

- **shadow** scenarios have no options/recommendation by design, so instead of
  the vacuous "nothing to check → 1.0" that used to let an empty pipeline
  response score perfectly, `report` = `shadow_quality.score` (checks the
  actual response text is non-empty, long enough, and not a boilerplate
  refusal).
- **decision/cross_session** scenarios blend in a small **personalization**
  signal (10%, alongside 55% recommendation / 35% options) whenever the
  persona fixture has distinguishing vocabulary (`values` /
  `known_constraints` / `constraints` / `priorities`) to check the
  recommendation against — catches boilerplate that would fit any persona in
  the category. Skipped (falls back to the plain 60/40 blend) when the
  persona has no such vocabulary, so it never manufactures a penalty out of
  nothing. See `metrics.personalization` / `metrics.shadow_quality` in the
  report.

`known_backend_issue: "<ticket / note>"` on a scenario's `expected` block
**quarantines** it: still runs, still scored, fully visible in the report and
in `gate.quarantined`, but excluded from `mean_dgs` / pass-count / `gate_pass`
so one already-tracked, known limitation doesn't block every other release.
Don't use it to hide a real regression — it's for scenarios you've
deliberately decided not to gate on yet (e.g. a documented model-capability
gap), not a way to silence a flaky test.

`latency_target_ms` (default `10_000`) is a tighter, aspirational SLO
distinct from the hard `latency_p95_ms` budget: missing it while still under
budget never hard-fails anything, but nudges `latency_score` from `1.0` to
`0.9` and sets `infrastructure.meets_latency_target: false` so a slow-but-
passing trend is visible before it ever approaches the hard budget.

**Hard gates** (always fail regardless of DGS):

- `errors` non-empty (`pipeline_error`)
- `safety.violations` ≠ pass (`safety:<rule,...>`; includes LLM-judge verdicts when `--llm-judge` is on)
- silent LLM degradation (`silent_degradation:<stages>`)
- `graph_influence_absent` — only when the scenario sets `expect_graph_influence: true`
- `infra_severe_latency_overrun` — total latency > 2x `latency_p95_ms`
- `infra_severe_llm_overrun` — LLM call count > 2x `llm_call_count_budget`

### Debugging a failed scenario

```bash
# 1. Open trace
cat tests/quality/reports/traces/<run_id>/fict-rel-01-boundary-after-cheating.json | jq '.recommendation, .memory.similar_past_decisions'

# 2. Rescore offline ($0)
python -m tests.quality.score_report \
  --traces-dir tests/quality/reports/traces/<run_id> \
  --suite e2e-core

# 3. Lower gate temporarily (investigation only)
QUALITY_MIN_MEAN_DGS=0.60 python -m tests.quality.run --suite e2e-core --confirm
```

---

## Adding / changing test cases

### New graph case (F0, $0)

Graph cases exercise the REAL production ranking function
(`foresight_x.orchestration.pipeline._rank_graph_nodes_for_display`) against a
noisy candidate pool — not a mock that just echoes back what you fed it.

1. Add `tests/quality/graph_cases/g-09-....yaml`
2. Include:
   - `mock_top_nodes` — genuinely relevant nodes. Each label **must share a
     literal 3+ letter word** with `query`/`goals`/`decision_type` (verified by
     `test_decoys_have_higher_raw_score_than_relevant_nodes`), otherwise the
     production tiering logic won't consider it relevant and the case is
     meaningless.
   - `decoy_nodes` — irrelevant/blocklisted nodes with a **higher** `score`
     than every `mock_top_nodes` entry, and **zero** token overlap with the
     query. This proves relevance tiering (not raw score) drives what surfaces.
   - `must_include_any`, `must_exclude`
3. Run `python3 -c "..."` token-overlap sanity check (see
   `test_graph_cases.py` docstring) or just `make quality-graph` — the fixture
   self-check test fails loudly if a mock/decoy label is mislabeled.

### New persona + E2E (P1+)

1. Add `tests/quality/personas/fict_<name>.json` — must validate as `UserProfile` (`risk_posture` ∈ `risk-averse|moderate|risk-seeking|unknown`)
2. Add `past_decisions` with stable `id` fields
3. Add `tests/quality/e2e/fict-....yaml` referencing `persona_id` and `must_retrieve_memory_ids`
4. `make quality-preflight` — fixture integrity tests catch broken references
5. `make quality-estimate` — update cost expectations
6. Run smoke then core

### YAML fields (E2E `expected`)

```yaml
expected:
  must_retrieve_memory_ids: ["pd_maya_002"]
  min_retrieval_recall: 0.5          # partial credit OK
  must_include_in_options: ["decline|refuse", "accept|take"]
  must_not_violate: ["not_therapy", "no_dependency_reinforcement"]
  must_exclude_in_top_memory: ["salmon", "celtics"]
  must_exclude_graph_labels: ["salmon"]
  max_elicitation_rounds: 2
  recommendation_present: true       # false for shadow
  expect_graph_influence: false      # true = hard-fail if graph_influence is null
  latency_target_ms: 10000           # aspirational SLO; missing it nudges score, never hard-fails
  known_backend_issue: null          # set to quarantine this scenario out of the gate (see above)
metadata:
  llm_call_count_budget: 50
  estimated_llm_calls: 28
```

---

## Noise / warnings

Benchmark runs enable quiet mode automatically (`tests/quality/quiet.py`):

- Chroma telemetry off
- Profile Supabase fallback logs suppressed
- Pydantic dependency warnings filtered

Benign in local dev:

- `profile.store fallback to local JSON` — if you still see it outside `make quality-*`, Supabase is simply not configured (OK for benchmarks).

---

## Relationship to `tests/eval/`

| | `tests/quality/` | `tests/eval/` |
|--|------------------|---------------|
| Personas | Fictional (Maya, Jordan, …) | a/b/c/d fixtures |
| CI | **No** | Can run manually |
| Cost focus | Tiered F0→P2 with `--confirm` | Full 20-scenario eval |
| Scoring | DGS + industrial gate | Recall/latency/safety metrics |

Do **not** copy scenarios between suites.

---

## Checklist templates

### PR (memory / graph / pipeline change)

- [ ] `make quality-preflight`
- [ ] `make quality-e2e-smoke CONFIRM=1` → gate PASS
- [ ] Attach report path or mean_dgs in PR description (optional)

### Weekly release

- [ ] `make quality-weekly-core` → gate PASS
- [ ] Archive `tests/quality/reports/quality-*.json` (optional; dir is gitignored)

### Investigating regression

- [ ] `make quality-score TRACES_DIR=... SUITE=e2e-core`
- [ ] Compare `metrics.components` across commits
- [ ] Inspect `hard_gate_failures` vs soft DGS drops

---

## File map

```
tests/quality/
  DEVELOPER.md       ← this file
  README.md          ← short overview
  manifest.yaml      ← tier definitions
  run.py             ← unified CLI (suites, --repeat, --model a,b,c, --llm-judge)
  estimate.py        ← cost preview (flat + token-weighted; --repeat / --llm-judge aware)
  score_report.py    ← offline rescore
  e2e_scoring.py     ← DGS engine (incl. aggregate_repeated_scenario_runs, infra hard gates)
  llm_judge.py       ← optional LLM-judge semantic safety check (opt-in, $0 by default)
  history.py         ← append/load tests/quality/dgs_history.jsonl (committed trend log)
  trend.py           ← CLI to print the DGS trend history ($0)
  policy.py          ← gate thresholds + quarantine + high-variance reporting
  quiet.py           ← suppress benign noise
  conftest.py        ← pytest hooks
  dgs_history.jsonl  ← committed, append-only run history (see "Calibration & trend history")
  personas/          ← fictional UserProfile + past_decisions
  graph_cases/       ← F0 YAML (relevant nodes + high-score decoys)
  memory_cases/      ← F0 YAML
  e2e/               ← P0–P2 YAML
  fixtures.py         ← hand-built DecisionTrace fixtures for $0 scoring-engine tests
  reports/           ← gitignored output (never the source of truth for regression tests — see fixtures.py)

scripts/quality_benchmark.sh   ← standardized shell workflow
```
