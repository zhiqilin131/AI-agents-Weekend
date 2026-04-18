# Foresight-X package

Python package implementing the RIS pipeline and Harness. See repository root specs:

- `foresight_x_product_spec.md`
- `foresight_x_technical_architecture.md`

## Install (development)

```bash
pip install -e ".[dev]"
pytest
```

Phase 0 delivers `schemas` and `config` with contract tests under `tests/`.

Phase 1 delivers `retrieval/`: `UserMemory` and `WorldKnowledge` (Chroma + LlamaIndex), `TavilyGateway`, packaged seeds under `retrieval/seeds/`, and tests (`test_memory`, `test_world_cache`, `test_tavily_client`, `test_seed`).

Phase 6 adds UI entry points:

- CLI run: `python -m foresight_x.ui.cli "I got an offer from Company X..."`
- Outcome capture: `python -m foresight_x.ui.cli --record-outcome <decision_id>`
- Streamlit app: `streamlit run foresight_x/ui/app.py`
