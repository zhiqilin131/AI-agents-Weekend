"""Cost-friendly quality benchmark (manual invoke only).

Suites:
  free      — pytest, $0 (graph scoring, report, MCDA, memory precision)
  graph     — graph YAML cases only, $0
  e2e-core  — 6 fictional decision E2E scenarios (~$0.36 ceiling)
  e2e-all   — all fictional E2E incl. cross-session/shadow (~$0.50 ceiling)

Run: python -m tests.quality.run --suite free
     python -m tests.quality.estimate --suite e2e-core
     python -m tests.quality.run --suite e2e-core --confirm
"""
