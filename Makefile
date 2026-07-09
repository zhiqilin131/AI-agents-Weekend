PYTHON ?= python3
PIP ?= $(PYTHON) -m pip

.PHONY: setup setup-web test test-web run-api run-web smoke doctor clean-web chaos-demo

setup:
	$(PIP) install -e ".[dev,web]"

setup-web:
	npm --prefix web install

test:
	$(PYTHON) -m pytest -q

test-web:
	npm --prefix web run test -- --run

run-api:
	uvicorn foresight_x.ui.api_server:app --host 127.0.0.1 --port 8765 --reload

run-web:
	npm --prefix web run dev

smoke:
	$(PYTHON) scripts/smoke_tavily.py

doctor:
	$(PYTHON) scripts/repro_check.py

clean-web:
	rm -rf web/dist

chaos-demo:
	FX_CHAOS=1 $(PYTHON) scripts/chaos_demo.py

.PHONY: eval eval-single eval-baseline

eval:
	python3 -m tests.eval.runner.run --scenarios all --model gpt-4o-mini

eval-single:
	python3 -m tests.eval.runner.run --scenarios $(SCENARIO) --model gpt-4o-mini

eval-baseline:
	@python3 -c "import json; r=json.load(open('tests/eval/reports/baseline.json')); print(f'Baseline: commit={r[\"commit_sha\"]}, pass_rate={r[\"aggregate\"][\"pass_rate\"]:.2f}, excl_known={r[\"aggregate\"][\"pass_rate_excluding_known_issues\"]:.2f}, model={r[\"model_id\"]}')"

.PHONY: quality-help quality-preflight quality-graph quality-mcda quality-report quality-memory
.PHONY: quality-estimate quality-e2e-smoke quality-e2e-core quality-e2e-all
.PHONY: quality-score quality-weekly quality-weekly-core quality-trend

quality-help:
	@echo "Quality benchmark (manual, not CI) — see tests/quality/DEVELOPER.md"
	@echo ""
	@echo "  make quality-preflight          F0  free suite (\$$0)"
	@echo "  make quality-graph              F1  graph blocklist only"
	@echo "  make quality-mcda               F1  MCDA / elicitation only"
	@echo "  make quality-report             F1  report surface only"
	@echo "  make quality-memory             F1  memory precision only"
	@echo "  make quality-estimate           preview P1 cost (add REPEAT=n, LLM_JUDGE=1)"
	@echo "  make quality-e2e-smoke CONFIRM=1   P0  ~\$$0.02"
	@echo "  make quality-e2e-core CONFIRM=1    P1  ~\$$0.36"
	@echo "  make quality-e2e-all CONFIRM=1     P2  ~\$$0.50"
	@echo "                                   optional on any e2e-* target:"
	@echo "                                     MODEL=gpt-4o-mini[,gpt-4o,...]  (comma list = comparison run)"
	@echo "                                     REPEAT=n     (median dgs + majority-vote status over n runs)"
	@echo "                                     LLM_JUDGE=1  (opt-in semantic safety judge, extra \$$ per scenario)"
	@echo "  make quality-weekly             F0 + estimate + smoke"
	@echo "  make quality-weekly-core        weekly + e2e-core"
	@echo "  make quality-score TRACES_DIR=... SUITE=e2e-core"
	@echo "  make quality-trend              print tests/quality/dgs_history.jsonl trend (\$$0)"
	@echo ""
	@echo "  ./scripts/quality_benchmark.sh help"

quality-preflight:
	$(PYTHON) -m tests.quality.run --suite free

quality-free: quality-preflight

quality-graph:
	$(PYTHON) -m tests.quality.run --suite graph

quality-mcda:
	$(PYTHON) -m tests.quality.run --suite mcda

quality-report:
	$(PYTHON) -m tests.quality.run --suite report

quality-memory:
	$(PYTHON) -m tests.quality.run --suite memory

quality-estimate:
	$(PYTHON) -m tests.quality.estimate --suite e2e-core $(if $(REPEAT),--repeat $(REPEAT),) $(if $(LLM_JUDGE),--llm-judge,)

quality-e2e-smoke:
	$(PYTHON) -m tests.quality.run --suite e2e-smoke $(if $(CONFIRM),--confirm,) $(if $(MODEL),--model $(MODEL),) $(if $(REPEAT),--repeat $(REPEAT),) $(if $(LLM_JUDGE),--llm-judge,)

quality-e2e-core:
	$(PYTHON) -m tests.quality.run --suite e2e-core $(if $(CONFIRM),--confirm,) $(if $(MODEL),--model $(MODEL),) $(if $(REPEAT),--repeat $(REPEAT),) $(if $(LLM_JUDGE),--llm-judge,)

quality-e2e-all:
	$(PYTHON) -m tests.quality.run --suite e2e-all $(if $(CONFIRM),--confirm,) $(if $(MODEL),--model $(MODEL),) $(if $(REPEAT),--repeat $(REPEAT),) $(if $(LLM_JUDGE),--llm-judge,)

quality-score:
	@test -n "$(TRACES_DIR)" || (echo "Set TRACES_DIR=tests/quality/reports/traces/<run_id>" && exit 2)
	$(PYTHON) -m tests.quality.score_report --traces-dir $(TRACES_DIR) --suite $(or $(SUITE),e2e-core)

quality-weekly:
	FORESIGHT_QUALITY_QUIET=1 ANONYMIZED_TELEMETRY=False ./scripts/quality_benchmark.sh weekly

quality-weekly-core:
	FORESIGHT_QUALITY_QUIET=1 ANONYMIZED_TELEMETRY=False RUN_CORE=1 ./scripts/quality_benchmark.sh weekly

quality-trend:
	$(PYTHON) -m tests.quality.trend $(if $(LAST),--last $(LAST),) $(if $(SCENARIO),--scenario $(SCENARIO),)
