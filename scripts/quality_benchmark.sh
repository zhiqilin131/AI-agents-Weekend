#!/usr/bin/env bash
# Standardized quality benchmark workflow (manual, not CI).
# Usage: ./scripts/quality_benchmark.sh <command> [args]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
export FORESIGHT_QUALITY_QUIET=1
export ANONYMIZED_TELEMETRY=False

die() { echo "error: $*" >&2; exit 2; }

require_api_key() {
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    die "OPENAI_API_KEY is not set. Add it to .env or export before paid tiers (P0+)."
  fi
}

cmd_preflight() {
  echo "━━━ Tier F0: preflight (free, \$0) ━━━"
  "$PYTHON" -m tests.quality.run --suite free
  echo "✓ preflight passed"
}

cmd_estimate() {
  local suite="${1:-e2e-core}"
  echo "━━━ Cost estimate: ${suite} ━━━"
  "$PYTHON" -m tests.quality.estimate --suite "$suite"
}

cmd_run() {
  local suite="${1:-}"
  [[ -n "$suite" ]] || die "usage: run <e2e-smoke|e2e-core|e2e-all>"
  require_api_key
  echo "━━━ Tier ${suite} (paid) ━━━"
  cmd_estimate "$suite"
  "$PYTHON" -m tests.quality.run --suite "$suite" --confirm "${@:2}"
}

cmd_rescore() {
  local traces_dir="${1:-}"
  local suite="${2:-e2e-core}"
  [[ -n "$traces_dir" ]] || die "usage: rescore <traces_dir> [suite]"
  [[ -d "$traces_dir" ]] || die "traces dir not found: $traces_dir"
  echo "━━━ Rescore traces (free, \$0) ━━━"
  "$PYTHON" -m tests.quality.score_report --traces-dir "$traces_dir" --suite "$suite"
}

# Industrial weekly cadence: F0 → estimate P1 → P0 smoke → optional P1 core
cmd_weekly() {
  local run_core="${RUN_CORE:-0}"
  cmd_preflight
  echo ""
  cmd_estimate e2e-core
  echo ""
  cmd_run e2e-smoke
  if [[ "$run_core" == "1" ]]; then
    echo ""
    cmd_run e2e-core
  else
    echo ""
    echo "Tip: run full core with: RUN_CORE=1 $0 weekly"
  fi
}

cmd_help() {
  cat <<'EOF'
Foresight-X Quality Benchmark — developer workflow
================================================

NOT wired to CI. Run manually when changing memory, graph, MCDA, or pipeline code.

Commands
--------
  preflight              F0 free suite ($0) — run on every relevant change
  estimate [suite]       Preview LLM cost (default: e2e-core)
  run <suite>            Paid run with --confirm (e2e-smoke | e2e-core | e2e-all)
  rescore <dir> [suite]  Re-score saved traces ($0, no API)
  weekly                 preflight → estimate → smoke → [optional core if RUN_CORE=1]
  help                   This message

Make equivalents
----------------
  make quality-help
  make quality-preflight
  make quality-estimate
  make quality-e2e-smoke CONFIRM=1
  make quality-e2e-core CONFIRM=1
  make quality-weekly
  make quality-weekly-core    # includes e2e-core

Cadence (industrial)
--------------------
  Every change (graph/MCDA/pipeline/report)  →  preflight
  Before merge                               →  e2e-smoke  (~$0.02)
  Weekly / pre-release                       →  e2e-core   (~$0.36)
  Monthly                                    →  e2e-all    (~$0.50)

Docs: tests/quality/DEVELOPER.md
EOF
}

main() {
  local command="${1:-help}"
  shift || true
  case "$command" in
    preflight) cmd_preflight "$@" ;;
    estimate)  cmd_estimate "$@" ;;
    run)       cmd_run "$@" ;;
    rescore)   cmd_rescore "$@" ;;
    weekly)    cmd_weekly "$@" ;;
    help|-h|--help) cmd_help ;;
    *) die "unknown command: $command (try: help)" ;;
  esac
}

main "$@"
