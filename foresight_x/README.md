# Foresight-X package

Python package implementing the RIS pipeline and Harness. **Overview, memory vs evidence buckets, and run instructions:** repository root `README.md`.

Specs:

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

### Web UI (`web/` — Vite + React)

Requires Python extras **`web`** (FastAPI, Uvicorn, multipart, optional ASR/TTS deps) and Node/npm.

1. Install backend: `pip install -e ".[web]"`
2. From `web/`, start API + Vite together:

   ```bash
   npm install
   npm run dev:all
   ```

   Or run separately: `python -m uvicorn foresight_x.ui.api_server:app --host 127.0.0.1 --port 8765 --reload` (repo root) and `npm run dev` (`web/`).

**Slime Buddy** (`/buddy`): voice commands, 3D slime, shared thread store with Shadow; **Decision Report** stream when you confirm Decision Mode.

3. Open **`http://127.0.0.1:5173`**. Use repo-root `.env` for `OPENAI_API_KEY` / `TAVILY_API_KEY` (same as CLI). `web/.env.development` should keep `VITE_API_ORIGIN=http://127.0.0.1:8765`.

Production: `cd web && npm run build` — output in `web/dist/` (serve static files + run the API separately).
