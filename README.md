# AI-agents-Weekend — Foresight-X

Evidence-grounded decision agent: **perceive → retrieve → infer → simulate → decide → reflect**.  
Specs: `foresight_x_product_spec.md`, `foresight_x_technical_architecture.md`.

## What it does

- **Perception:** natural language → structured `UserState`; optional **query enhancement**; optional **clarification gate** (1–2 multiple-choice questions if input is too vague).
- **Retrieval (parallel):**
  - **UserMemory** (Chroma, per `FORESIGHT_USER_ID`): **similar past decisions** + **behavioral pattern** labels. This is **not** a dump of full chat history — only indexed decision records you have stored (e.g. via outcomes / harness).
  - **WorldKnowledge** (global Chroma + optional **Tavily**): **facts**, **base rates / baselines**, and **live web lines**. All **web search** snippets are surfaced under **base rates** as `Live reference (aligned to your question): …`. The **Recent events** bucket is reserved for non-URL / local event-style lines (usually empty when everything comes from the web).
- **Inference:** bias / irrationality check; **option generation**.
- **Simulation:** **multi-future** scenarios per option (best / base / worst) with probabilities; prompt uses **EvidenceBundle** and optional **MemoryBundle** for calibration.
- **Evaluation & recommendation:** multi-criteria scores; **reflection** and persisted **traces** under `data/traces/` (gitignored JSON).
- **Profiles:** classic user profile (`data/profile/`) and optional **tier-3 semantic profile** (`data/profiles/`, see `cursor_tier3_profile_prompt.md`) for recommender weighting.

## Stack

Python 3.11+, **OpenAI** (chat + embeddings), **LlamaIndex**, **Chroma**, **Tavily** (optional live search; tests mock the client), **FastAPI** + **Uvicorn**, **React + Vite** frontend with **SSE** streaming.

## Setup

```bash
pip install -e ".[dev]"
pytest
```

**Environment:** `cp .env.example .env`, then set `OPENAI_API_KEY` and, for live web retrieval, `TAVILY_API_KEY`.  
If `python` raises `KeyError: 'TAVILY_API_KEY'`, the variable is missing from `.env`.

**Smoke test (Tavily):** same Python environment as the app, then `python scripts/smoke_tavily.py`. Install `tavily-python` if needed.

## Run the web app

1. API (repo root):

   ```bash
   pip install -e ".[web]"
   uvicorn foresight_x.ui.api_server:app --host 127.0.0.1 --port 8765 --reload
   ```

2. Frontend:

   ```bash
   cd web && npm install && npm run dev
   ```

   Point `web/.env.development` at the API, e.g. `VITE_API_ORIGIN=http://127.0.0.1:8765`.

3. Open the URL Vite prints (often `http://localhost:5173`).

**CLI:** `python -m foresight_x.ui.cli "…"` — see `foresight_x/README.md`.

## Memory vs evidence (UI)

| Section | Meaning |
|--------|---------|
| **Similar past decisions / Patterns** | From **UserMemory** — needs indexed past decisions for your user id. Empty if Chroma has no matching history yet. |
| **Base rates** | Priors + **all Tavily / web lines** (live reference prefix). |
| **Recent events** | Non-web event snippets only; web results are **not** listed here. |

Stale world seeds after code changes: delete `data/chroma` (or only the world collection) and re-ingest / re-run.

## License / team

Hackathon / coursework project — see repository owners for contribution policy.
