# Foresight-X

**Evidence-grounded decision assistant:** perceive → retrieve → infer → simulate → decide → reflect.  
Web app: **Shadow Chat** (streaming), **Slime Buddy** (voice-first companion, 3D slime, profile memory toasts, optional **Decision Report** flow), **Home / Profile / Execution** planner, and classic pipeline runs from **Home**.

**Repository:** [github.com/zhiqilin131/Foresight-x](https://github.com/zhiqilin131/Foresight-x)  
Design specs: `foresight_x_product_spec.md`, `foresight_x_technical_architecture.md`.

## What it does

- **Perception:** natural language → structured `UserState`; optional **query enhancement**; optional **clarification gate** (Shadow) when input is too vague.
- **Retrieval (parallel):**
  - **UserMemory** (Chroma, per `FORESIGHT_USER_ID`): similar past decisions + behavioral pattern labels (indexed decision records, not full chat dumps).
  - **WorldKnowledge** (global Chroma + optional **Tavily**): facts, base rates, and **live web** lines (`Live reference …` under base rates). **Recent events** is for non-web snippets only.
- **Inference:** bias check; option generation.
- **Simulation:** multi-future scenarios per option; uses **EvidenceBundle** + optional **MemoryBundle**.
- **Evaluation & recommendation:** MCDA-style scores; **reflection**; traces under `data/traces/` (gitignored JSON).
- **Profiles:** classic profile (`data/profile/`) and optional **tier-3 semantic profile** (`data/profiles/`) for recommender weighting.
- **Voice (Slime Buddy):** ASR → routed tools or shared **conversation** turn (same core as Shadow); server TTS optional; **Decision Mode** card when intent is decision-like.

## Stack

- **Backend:** Python 3.11+, **FastAPI**, **OpenAI** (chat, embeddings, Whisper/TTS where configured), **LlamaIndex**, **Chroma**, **Tavily** (optional), **faster-whisper** (optional local ASR).
- **Frontend:** **React 18**, **Vite 6**, **TypeScript**, **Tailwind 4**, **React Three Fiber** (slime), **SSE** streaming.

Dependency versions are pinned in `pyproject.toml` and `web/package.json`; upgrade with care (LlamaIndex + React majors may need code changes).

## Setup

```bash
pip install -e ".[dev]"
pytest
```

For a repeatable local workflow, see `docs/REPRODUCIBILITY.md` (`make setup`, `make doctor`).

**Environment:** `cp .env.example .env`, then set `OPENAI_API_KEY` and, for live web retrieval, `TAVILY_API_KEY`.  
If you see `KeyError: 'TAVILY_API_KEY'`, the variable is missing from `.env`.

**Smoke test (Tavily):** `python scripts/smoke_tavily.py` (same venv as the app).

## Run the web app

One-shot (API **and** Vite; recommended):

```bash
pip install -e ".[web]"
cd web && npm install && npm run dev:all
```

Open **`http://127.0.0.1:5173`**. The dev client uses **`http://127.0.0.1:8765`** for the API (`web/.env.development`).

**Routes (hash router):** `/` Home, `/buddy` Slime Buddy, `/reflect` Shadow Chat, `/profile`, `/execution`, `/login`, `/register`, etc.

Split terminals (optional):

1. API (repo root): `python -m uvicorn foresight_x.ui.api_server:app --host 127.0.0.1 --port 8765 --reload`
2. Frontend: `cd web && npm run dev`

**CLI:** `python -m foresight_x.ui.cli "…"` — see `foresight_x/README.md`.

## Memory vs evidence (UI)

| Section | Meaning |
|--------|---------|
| **Similar past decisions / Patterns** | **UserMemory** — needs indexed past decisions for your user id. |
| **Base rates** | Priors + **Tavily / web** lines (live reference prefix). |
| **Recent events** | Non-web snippets only. |

Stale seeds after code changes: delete `data/chroma` (or the world collection) and re-ingest / re-run.

## Auth (Supabase email + password)

Optional for local dev: leave `VITE_SUPABASE_URL` unset and the app behaves as before (persona switcher + file-backed `FORESIGHT_USER_ID`).

**Supabase project:** enable the **Email** auth provider; configure whether new users must confirm email. Ensure RLS policies on tables such as `threads` use `auth.uid()` as needed.

**Frontend (`web/.env` or hosting env):**

- `VITE_SUPABASE_URL` — project URL
- `VITE_SUPABASE_ANON_KEY` — anon (public) key

If both are set, the SPA requires sign-in before Chat, Profile, etc. Omit either variable for local persona-only mode without a login screen.

**Backend:** `SUPABASE_URL` must match the same project (JWKS verification). **When `SUPABASE_URL` is non-empty, `REQUIRE_AUTH` is forced on** unless you explicitly set `ALLOW_PERSONA_FALLBACK_WITH_SUPABASE=true` (unsafe: one shared on-disk “persona” for every caller). With the default, every `/api/*` call must include `Authorization: Bearer <access_token>` (except `/api/health` and docs). The JWT **`sub`** becomes `foresight_user_id` for that request, so **chat threads, Chroma memory, profiles, traces, graph, diary**, etc. stay isolated per login. Switching accounts in the browser therefore only shows that account’s data.

See `web/.env.example` and repo `.env.example`.

## Docs

- Voice / Slime: `docs/voice_slime_agent.md`, `docs/voice_asr.md`

## GitHub About (maintainers)

If you have admin on the repo, paste this into **About → Description**:

> Evidence-grounded decision assistant: structured reports, vector memory (Chroma), Shadow Chat & Slime Buddy voice UI. FastAPI + React/Vite.

Suggested **topics:** `decision-support`, `ai-agents`, `llm`, `fastapi`, `react`, `python`, `chromadb`, `vite`

## License / team

Hackathon / coursework — see repository owners for contribution policy.
