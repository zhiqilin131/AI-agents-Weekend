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
	$(PYTHON) scripts/chaos_demo.py

.PHONY: eval eval-single eval-baseline

eval:
	python3 -m tests.eval.runner.run --scenarios all --model gpt-4o-mini

eval-single:
	python3 -m tests.eval.runner.run --scenarios $(SCENARIO) --model gpt-4o-mini

eval-baseline:
	@python3 -c "import json; r=json.load(open('tests/eval/reports/baseline.json')); print(f'Baseline: commit={r[\"commit_sha\"]}, pass_rate={r[\"aggregate\"][\"pass_rate\"]:.2f}, excl_known={r[\"aggregate\"][\"pass_rate_excluding_known_issues\"]:.2f}, model={r[\"model_id\"]}')"
