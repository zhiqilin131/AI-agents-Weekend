# Foresight-X — Launch Plan (Cursor-Executable)

> **Goal**: Ship Foresight-X to a 5-person internal testing team in 3 days, optimized for low latency and concurrent multi-user testing.
>
> **Stack**: FastAPI (backend) + React/Vite (frontend) + Supabase (auth + Postgres) + Upstash (Redis) + Chroma (vectors, on Railway volume for v1) + LlamaIndex + Tavily + OpenAI.
>
> **Hosting**: Vercel (frontend) + Railway (backend) + Supabase (DB) + Upstash (Redis) + Sentry (errors).
>
> **For Cursor**: Execute phases sequentially. Each phase has a "Verify" block — do not move to the next phase until verification passes. Code blocks are copy-paste-ready unless marked `# ADAPT`.

> **Repo layout assumptions**: This repo uses `foresight_x/` (backend Python package) and `web/` (frontend Vite app). The FastAPI app object is `foresight_x.ui.api_server:app`. Backend dev port is `8765`; frontend dev port is `5173`. Paths and command examples below are aligned to this layout.

---

## Table of Contents

1. [Prerequisites](#phase-0--prerequisites)
2. [Repo Preparation](#phase-1--repo-preparation)
3. [External Services Setup](#phase-2--external-services)
4. [Database Schema](#phase-3--supabase-schema--rls)
5. [Backend Code Changes](#phase-4--backend-code-changes)
6. [Performance Layer](#phase-5--performance-optimization)
7. [Backend Deployment (Railway)](#phase-6--backend-deployment-railway)
8. [Frontend Code Changes (Auth)](#phase-7--frontend-code-changes)
9. [Frontend Deployment (Vercel)](#phase-8--frontend-deployment-vercel)
10. [Multi-Tester Setup](#phase-9--multi-tester-setup)
11. [Observability (Sentry)](#phase-10--observability)
12. [CI/CD](#phase-11--cicd)
13. [Smoke Test](#phase-12--smoke-test)
14. [Troubleshooting](#troubleshooting)

---

## Phase 0 — Prerequisites

### Accounts to create (one team member does this, shares secrets via 1Password / Doppler)

- [ ] [Supabase](https://supabase.com) — DB + Auth
- [ ] [Upstash](https://upstash.com) — Redis
- [ ] [Railway](https://railway.app) — Backend hosting
- [ ] [Vercel](https://vercel.com) — Frontend hosting
- [ ] [Sentry](https://sentry.io) — Error trackings
- [ ] OpenAI API key (existing)
- [ ] Tavily API key (existing)

### Local tools

```bash
# All team members install
brew install supabase/tap/supabase   # Supabase CLI
npm i -g vercel                      # Vercel CLI (optional)
brew install railway                  # Railway CLI (optional)
```

### Repo branch protection (GitHub repo settings)

- [ ] `main` requires PR before merge
- [ ] `main` requires 1 approving review
- [ ] `main` requires CI pass
- [ ] No force push allowed

---

## Phase 1 — Repo Preparation

### 1.1 Create env file structure

Create three env templates at repo root:

**`.env.example`** (committed, no secrets)
```bash
# === Backend ===
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
REDIS_URL=
OPENAI_API_KEY=
TAVILY_API_KEY=
ANTHROPIC_API_KEY=
CHROMA_PERSIST_DIR=./chroma_data
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
CORS_PREVIEW_REGEX=
SENTRY_DSN_BACKEND=
ENVIRONMENT=local

# === Frontend (prefix with VITE_) ===
VITE_API_BASE_URL=http://127.0.0.1:8765
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SENTRY_DSN_FRONTEND=
```

**`.gitignore`** — confirm these lines exist:
```
.env
.env.local
.env.production
chroma_data/
__pycache__/
node_modules/
dist/
.venv/
```

### 1.2 Branch strategy

```
main          → production (auto-deploys to Railway + Vercel)
staging       → staging env (auto-deploys to staging URLs)
feature/xxx   → feature branches (preview deploys on Vercel)
```

**Verify**: `git branch -a` shows `main` and `staging`. PRs target `staging` first, then `staging` → `main` weekly.

---

## Phase 2 — External Services

### 2.1 Supabase

1. https://supabase.com → New project
   - **Region**: `us-east-1` (closest to Railway US-East)
   - **Database password**: store in 1Password
2. After provision (~2 min), go to **Project Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon` key → `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ backend only, never frontend)
3. **Project Settings → API → JWT Settings**, copy `JWT Secret` → `SUPABASE_JWT_SECRET`
4. **Database → Connection Pooling**, copy the **pooler** connection string (port `6543`, transaction mode) — use this in backend, NOT the direct connection (port 5432) for serverless reasons.

### 2.2 Upstash Redis

1. https://console.upstash.com → Create Database
   - **Type**: Regional (cheaper than Global for v1)
   - **Region**: `us-east-1`
   - **TLS**: enabled
2. Copy **Redis URL** (starts with `rediss://`) → `REDIS_URL`

### 2.3 Sentry

1. https://sentry.io → New Project (×2)
   - `foresight-x-backend` (platform: Python/FastAPI)
   - `foresight-x-frontend` (platform: React)
2. Copy DSNs → `SENTRY_DSN_BACKEND` and `VITE_SENTRY_DSN_FRONTEND`

**Verify**: All three services accessible from dashboards. All env values pasted into a shared 1Password vault.

---

## Phase 3 — Supabase Schema + RLS

### 3.1 Run schema migration

In Supabase Dashboard → SQL Editor → paste and run:

> **Idempotency**: This script can be re-run safely. If you've already run an earlier version of the schema, **first** drop the trigger and function (they don't support `if not exists` cleanly):
>
> ```sql
> drop trigger if exists on_auth_user_created on auth.users;
> drop function if exists handle_new_user();
> ```
>
> Then run the full schema script.

```sql
-- ============ EXTENSIONS ============
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============ PROFILES ============
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============ THREADS (chat sessions) ============
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text,
  mode text check (mode in ('shadow', 'buddy', 'reflect')) default 'shadow',
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_threads_user on threads(user_id, created_at desc);

-- ============ MESSAGES ============
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads on delete cascade not null,
  role text check (role in ('user', 'assistant', 'system')) not null,
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_messages_thread on messages(thread_id, created_at);

-- ============ DECISIONS ============
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  thread_id uuid references threads,
  question text not null,
  context jsonb default '{}',
  status text check (status in ('draft', 'analyzing', 'ready', 'archived')) default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_decisions_user on decisions(user_id, created_at desc);

-- ============ REPORTS ============
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references decisions on delete cascade not null,
  content jsonb not null,
  options_count int default 0,
  evidence_count int default 0,
  generated_at timestamptz default now()
);
create index if not exists idx_reports_decision on reports(decision_id);

-- ============ EXECUTION ITEMS ============
create table if not exists execution_items (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references decisions on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  description text,
  status text check (status in ('pending', 'in_progress', 'done', 'skipped')) default 'pending',
  due_date date,
  order_idx int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_exec_user on execution_items(user_id, status);

-- ============ MEMORY POINTERS (links to Chroma vectors) ============
create table if not exists memory_pointers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  chroma_id text not null,         -- ID in Chroma collection
  tier text check (tier in ('episodic', 'semantic', 'procedural')) not null,
  summary text,
  created_at timestamptz default now()
);
create index if not exists idx_memory_user_tier on memory_pointers(user_id, tier);
```

### 3.2 Row Level Security (CRITICAL for multi-tester safety)

```sql
-- Enable RLS on all user-data tables
alter table profiles enable row level security;
alter table threads enable row level security;
alter table messages enable row level security;
alter table decisions enable row level security;
alter table reports enable row level security;
alter table execution_items enable row level security;
alter table memory_pointers enable row level security;

-- Profiles: users see/edit their own
drop policy if exists "profiles self access" on profiles;
create policy "profiles self access" on profiles
  for all using (auth.uid() = id);

-- Threads: users see their own
drop policy if exists "threads self access" on threads;
create policy "threads self access" on threads
  for all using (auth.uid() = user_id);

-- Messages: users see messages in their own threads
drop policy if exists "messages via thread" on messages;
create policy "messages via thread" on messages
  for all using (
    exists (select 1 from threads where threads.id = messages.thread_id and threads.user_id = auth.uid())
  );

-- Decisions
drop policy if exists "decisions self access" on decisions;
create policy "decisions self access" on decisions
  for all using (auth.uid() = user_id);

-- Reports: via decisions
drop policy if exists "reports via decision" on reports;
create policy "reports via decision" on reports
  for all using (
    exists (select 1 from decisions where decisions.id = reports.decision_id and decisions.user_id = auth.uid())
  );

-- Execution items
drop policy if exists "exec self access" on execution_items;
create policy "exec self access" on execution_items
  for all using (auth.uid() = user_id);

-- Memory pointers
drop policy if exists "memory self access" on memory_pointers;
create policy "memory self access" on memory_pointers
  for all using (auth.uid() = user_id);
```

**Verify RLS works (correct method)**:

The Supabase SQL Editor runs as superuser (bypasses RLS), so it cannot validate RLS. Use one of these instead:

**Option A — REST API with anon key + user JWT (recommended)**:

```bash
# 1. Get a user JWT by logging in via the frontend, then copy it from
#    DevTools → Application → Local Storage → sb-xxxxx-auth-token → access_token

USER_JWT="eyJ..."
SUPABASE_URL="https://xxxxx.supabase.co"
ANON_KEY="eyJ..."

# 2. Query as that user — should only return their rows
curl "$SUPABASE_URL/rest/v1/threads?select=*" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT"
```

**Option B — pgTAP-style role simulation in SQL**:

```sql
set local role authenticated;
set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
select count(*) from threads;  -- should match only that user's rows
reset role;
```

Two testers should each see only their own rows from Option A. If either sees the other's data, RLS is broken — do not proceed to launch.

---

## Phase 4 — Backend Code Changes

### 4.1 Add deployment dependencies to `pyproject.toml`

This project's source of truth is `pyproject.toml`, **not** `requirements.txt`. Do **not** create a parallel `requirements.txt` — it will cause environment drift.

Add the following to `[project.dependencies]` (or your existing dependency group) in `pyproject.toml`. Skip any already present:

```toml
dependencies = [
    # ... existing deps ...
    "supabase>=2.4.0",
    "redis>=5.0.0",
    "hiredis>=2.3.0",
    "sentry-sdk[fastapi]>=2.0.0",
    "python-jose[cryptography]>=3.3.0",
    "slowapi>=0.1.9",
    "orjson>=3.10.0",
    "pydantic-settings>=2.2.0",
]
```

Then regenerate the lockfile:

```bash
# If using uv
uv lock && uv sync

# If using pip-tools
pip-compile pyproject.toml -o requirements.lock
pip install -r requirements.lock

# If using poetry
poetry lock && poetry install
```

For Railway, the Dockerfile (Phase 6.1) installs from `pyproject.toml` directly — no `requirements.txt` needed.

### 4.2 Settings module

Create `foresight_x/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_ANON_KEY: str
    SUPABASE_JWT_SECRET: str

    # Redis
    REDIS_URL: str

    # LLM / Tools
    OPENAI_API_KEY: str
    TAVILY_API_KEY: str
    ANTHROPIC_API_KEY: str = ""

    # Chroma
    CHROMA_PERSIST_DIR: str = "/data/chroma"

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    CORS_PREVIEW_REGEX: str = ""

    # Observability
    SENTRY_DSN_BACKEND: str = ""
    ENVIRONMENT: str = "local"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

settings = Settings()
```

### 4.3 Supabase client

Create `foresight_x/db/supabase_client.py`:

```python
from supabase import create_client, Client
from foresight_x.config import settings

# Service-role client (backend admin, bypasses RLS)
supabase_admin: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_ROLE_KEY,
)

def supabase_for_user(user_jwt: str) -> Client:
    """User-scoped client; respects RLS."""
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(user_jwt)
    return client
```

### 4.4 Auth dependency (validate Supabase JWT)

Create `foresight_x/auth.py`:

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from foresight_x.config import settings

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")
    return {
        "id": payload["sub"],
        "email": payload.get("email"),
        "jwt": token,
    }
```

> **Note on JWT verification**: This example uses HS256 with shared `SUPABASE_JWT_SECRET`, which is Supabase's default. If your project switches to asymmetric signing (RS256/ES256 via JWKS), replace this with JWKS verification:
>
> ```python
> from jose import jwt
> import httpx
> JWKS = httpx.get(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json").json()
> payload = jwt.decode(token, JWKS, algorithms=["RS256", "ES256"], audience="authenticated")
> ```
>
> Cache JWKS for 1 hour to avoid hitting Supabase on every request.

### 4.5 Redis client + caching helper

Create `foresight_x/cache.py`:

```python
import hashlib
import json
import redis.asyncio as redis
from foresight_x.config import settings

redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

def cache_key(prefix: str, payload: dict) -> str:
    """Stable hash of a JSON-serializable payload."""
    blob = json.dumps(payload, sort_keys=True, default=str)
    h = hashlib.sha256(blob.encode()).hexdigest()[:16]
    return f"fx:{prefix}:{h}"

async def cached_call(prefix: str, payload: dict, fn, ttl: int = 3600):
    """Get-or-compute with Redis cache."""
    key = cache_key(prefix, payload)
    hit = await redis_client.get(key)
    if hit:
        return json.loads(hit)
    result = await fn()
    await redis_client.set(key, json.dumps(result, default=str), ex=ttl)
    return result
```

### 4.6 Main app with CORS, Sentry, rate limiting

Update `foresight_x/ui/api_server.py`:

```python
import re
import sentry_sdk
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from sentry_sdk.integrations.fastapi import FastApiIntegration
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from foresight_x.config import settings
from foresight_x.auth import get_current_user

# Sentry
if settings.SENTRY_DSN_BACKEND:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN_BACKEND,
        environment=settings.ENVIRONMENT,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.2,
    )

# Rate limiter (per IP; per-user limiter set in routes via user.id)
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Foresight-X API",
    default_response_class=ORJSONResponse,  # faster JSON serialization
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Exact origins (production + local dev)
EXACT_ORIGINS = settings.cors_origins_list

# Regex for Vercel preview deploys
PREVIEW_REGEX = settings.CORS_PREVIEW_REGEX or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=EXACT_ORIGINS,
    allow_origin_regex=PREVIEW_REGEX,  # wildcard in allow_origins does not work
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.ENVIRONMENT}

@app.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"]}

# ADAPT: include your existing routers below
# from foresight_x.ui import threads, decisions, reports
# app.include_router(threads.router, prefix="/api")
# app.include_router(decisions.router, prefix="/api")
# app.include_router(reports.router, prefix="/api")
```

**Verify locally**:
```bash
uvicorn foresight_x.ui.api_server:app --reload --port 8765
curl http://localhost:8765/health
# → {"status":"ok","env":"local"}
```

---

## Phase 5 — Performance Optimization

This phase is critical for "不要太慢" — apply all of these.

### 5.1 LLM response caching (Redis)

> **Day 1 scope**: Apply Redis caching to **only 1-2 high-frequency read paths** first. Do not wrap every LLM call on Day 1. Start with one route (for example buddy chat reply), verify stability, then expand.

Wrap LLM calls so identical prompts in 1 hour reuse the response:

```python
# foresight_x/services/llm.py
from foresight_x.cache import cached_call
from openai import AsyncOpenAI
from foresight_x.config import settings

client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

async def chat_completion_cached(messages: list, model: str = "gpt-4o-mini", **kwargs):
    payload = {"messages": messages, "model": model, **kwargs}

    async def call():
        resp = await client.chat.completions.create(
            messages=messages, model=model, **kwargs
        )
        return {
            "content": resp.choices[0].message.content,
            "usage": resp.usage.model_dump(),
        }

    # Don't cache if temperature > 0.3 (responses should vary)
    if kwargs.get("temperature", 0.7) > 0.3:
        return await call()
    return await cached_call("llm", payload, call, ttl=3600)
```

### 5.2 Streaming for long-running endpoints

Reports take 10–30s — never make users wait on a closed connection. Use Server-Sent Events:

```python
# foresight_x/ui/reports.py
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
import asyncio, json
from foresight_x.auth import get_current_user

router = APIRouter()

@router.post("/decisions/{decision_id}/report/stream")
async def stream_report(decision_id: str, user: dict = Depends(get_current_user)):
    async def event_gen():
        yield f"data: {json.dumps({'phase': 'started'})}\n\n"
        # ADAPT: replace with your actual report-generation pipeline
        for phase in ["retrieving", "evidence", "options", "synthesis"]:
            await asyncio.sleep(0.1)  # placeholder
            yield f"data: {json.dumps({'phase': phase})}\n\n"
        yield f"data: {json.dumps({'phase': 'done', 'report_id': '...'})}\n\n"
    return StreamingResponse(event_gen(), media_type="text/event-stream")
```

Frontend consumes via `EventSource` (no need for polling).

### 5.3 Background jobs for heavy work

For tasks > 30s (deep research, multi-step pipelines), don't block the request:

```python
from fastapi import BackgroundTasks

@router.post("/decisions/{id}/analyze")
async def analyze(id: str, bg: BackgroundTasks, user: dict = Depends(get_current_user)):
    bg.add_task(run_full_analysis, decision_id=id, user_id=user["id"])
    return {"status": "queued", "decision_id": id}
```

For >2-min jobs, upgrade to ARQ (Redis-backed queue) later.

### 5.4 Parallel tool calls

When report generation needs multiple sources, run them concurrently:

```python
import asyncio

async def gather_evidence(query: str):
    web_task = tavily_search(query)
    mem_task = chroma_query(query)
    web, mem = await asyncio.gather(web_task, mem_task)
    return {"web": web, "memory": mem}
```

### 5.5 DB connection pooling

Use the **Supabase pooler** (port 6543) — already done if you copied the pooler URL in Phase 2.1. The pooler handles concurrent connections from multiple Railway instances.

### 5.6 Response compression

Add gzip middleware to FastAPI:

```python
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
```

### 5.7 Frontend route splitting

In `web/src/App.tsx`:

```tsx
import { lazy, Suspense } from 'react';
const Buddy = lazy(() => import('./pages/Buddy'));
const Reflect = lazy(() => import('./pages/Reflect'));
const Report = lazy(() => import('./pages/Report'));

<Suspense fallback={<LoadingSpinner />}>
  <Routes>{/* ... */}</Routes>
</Suspense>
```

### 5.8 Vite production build optimization

Update `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
});
```

**Verify**: After deployment, Lighthouse score on `/` should be >80 performance.

---

## Phase 6 — Backend Deployment (Railway)

### 6.1 Add Dockerfile to backend root

```dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast resolver)
RUN pip install uv

# Copy dependency manifest first for layer caching
COPY pyproject.toml uv.lock* ./
RUN uv pip install --system --no-cache .

COPY . .

# Chroma persist dir mounted from Railway volume
RUN mkdir -p /data/chroma
ENV CHROMA_PERSIST_DIR=/data/chroma

EXPOSE 8765
CMD ["uvicorn", "foresight_x.ui.api_server:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "2"]
```

If you don't use `uv`, replace dependency install with:

```dockerfile
RUN pip install .
```

### 6.2 Add `railway.json` to backend root

```json
{
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "uvicorn foresight_x.ui.api_server:app --host 0.0.0.0 --port $PORT --workers 2",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### 6.3 Deploy

1. https://railway.app → New Project → Deploy from GitHub repo
2. Select your repo, set **Root Directory** to backend folder if monorepo
3. **Variables** tab → paste all backend env vars from Phase 1.1
4. **Settings → Volumes** → mount `/data` (1 GB is plenty for v1)
5. **Settings → Networking** → Generate Domain → copy URL (e.g. `foresight-x-api.up.railway.app`)
6. Set temporary:
   - `ALLOWED_ORIGINS=https://foresight-x.vercel.app`
   - `CORS_PREVIEW_REGEX=^https://foresight-x-[a-z0-9]+-yourteam\.vercel\.app$`

**Verify**:
```bash
curl https://foresight-x-api.up.railway.app/health
# → {"status":"ok","env":"production"}
```

---

## Phase 7 — Frontend Code Changes

### 7.1 Install Supabase + Sentry

```bash
cd web
npm i @supabase/supabase-js @sentry/react
```

### 7.2 Supabase client

Create `web/src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
```

### 7.3 API client with auto-attach JWT

Create `web/src/lib/api.ts`:

```ts
import { supabase } from './supabase';

const BASE = import.meta.env.VITE_API_BASE_URL;

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// SSE helper for streaming reports
export function streamApi(path: string, onEvent: (data: any) => void) {
  // EventSource doesn't support custom headers; pass token as query param
  // OR use fetch with ReadableStream — simpler:
  return supabase.auth.getSession().then(async ({ data: { session } }) => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          onEvent(JSON.parse(line.slice(6)));
        }
      }
    }
  });
}
```

### 7.4 Auth pages

Create `web/src/pages/Login.tsx`:

```tsx
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const sendLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/auth/callback' },
    });
    if (!error) setSent(true);
  };

  if (sent) return <div>Check your email for the magic link.</div>;

  return (
    <div className="login">
      <h1>Foresight-X</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
      />
      <button onClick={sendLink}>Send magic link</button>
    </div>
  );
}
```

Create `web/src/pages/AuthCallback.tsx`:

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const nav = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      nav(data.session ? '/' : '/login');
    });
  }, [nav]);
  return <div>Signing you in…</div>;
}
```

### 7.5 Auth guard

Create `web/src/components/RequireAuth.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (authed === null) return <div>Loading…</div>;
  if (!authed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

Wrap your routes:

```tsx
<Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
<Route path="/buddy" element={<RequireAuth><Buddy /></RequireAuth>} />
{/* etc. */}
<Route path="/login" element={<Login />} />
<Route path="/auth/callback" element={<AuthCallback />} />
```

### 7.6 Sentry init

In `web/src/main.tsx`, before React render:

```tsx
import * as Sentry from '@sentry/react';

if (import.meta.env.VITE_SENTRY_DSN_FRONTEND) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN_FRONTEND,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
  });
}
```

---

## Phase 8 — Frontend Deployment (Vercel)

### 8.1 Configure Supabase magic link redirect

Supabase Dashboard → **Authentication → URL Configuration**:
- Site URL: `https://foresight-x.vercel.app` (placeholder, update after deploy)
- Redirect URLs: add both
  - `http://localhost:5173/auth/callback`
  - `https://foresight-x.vercel.app/auth/callback`
  - `https://foresight-x-*-yourteam.vercel.app/auth/callback` (preview deploys; replace `yourteam`)

### 8.2 Deploy

1. https://vercel.com → Add New → Project → Import Git repo
2. **Root Directory**: `web` folder
3. **Framework Preset**: Vite
4. **Build Command**: `npm run build`
5. **Output Directory**: `dist`
6. **Environment Variables**:
   ```
   VITE_API_BASE_URL=https://foresight-x-api.up.railway.app
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   VITE_SENTRY_DSN_FRONTEND=https://...
   ```
7. Deploy → copy production URL

### 8.3 Tighten backend CORS

Railway → Variables → set:
```
ALLOWED_ORIGINS=https://foresight-x.vercel.app
CORS_PREVIEW_REGEX=^https://foresight-x-[a-z0-9]+-yourteam\.vercel\.app$
```

Replace `yourteam` with your Vercel team slug, then trigger redeploy on Railway.

### 8.4 Update Supabase Site URL

Replace placeholder with the real Vercel URL in Phase 8.1.

**Verify**: Open Vercel URL → log in with magic link → land on `/` → Network tab shows API calls to Railway URL with `Authorization: Bearer ...` header → 200 responses.

---

## Phase 9 — Multi-Tester Setup

### 9.1 Seed test users

Supabase Dashboard → Authentication → Users → **Invite user** for each teammate. They get a magic link via email.

OR programmatically (one-shot script `scripts/seed_users.py`):

```python
import os
from supabase import create_client

SUPA = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

testers = [
    "andrew@cmu.edu",
    "dev2@cmu.edu",
    "dev3@cmu.edu",
    "dev4@cmu.edu",
    "dev5@cmu.edu",
]

for email in testers:
    SUPA.auth.admin.invite_user_by_email(email)
    print(f"Invited {email}")
```

Run: `python scripts/seed_users.py`

### 9.2 Per-user rate limiting

In any heavy route, key the limiter on `user.id` instead of IP:

```python
from slowapi import Limiter
user_limiter = Limiter(key_func=lambda r: r.state.user_id if hasattr(r.state, 'user_id') else 'anon')

@router.post("/decisions/{id}/report")
@user_limiter.limit("5/minute")
async def gen_report(id: str, request: Request, user: dict = Depends(get_current_user)):
    request.state.user_id = user["id"]
    # ...
```

This prevents one tester from starving others.

### 9.3 Test data isolation check

Have two testers log in simultaneously and create threads. Each should only see their own. RLS handles this — verify by:

```sql
-- As tester 1 (in Supabase SQL editor with auth.uid() set):
select count(*) from threads;
-- Should equal tester 1's threads only
```

### 9.4 Tester quickstart doc

Create `docs/TESTER_GUIDE.md`:

```markdown
# Foresight-X Tester Quickstart

## 1. Get access
- Check email for magic link from Supabase
- Click → land on https://foresight-x.vercel.app

## 2. Test flows
- [ ] Login → home loads
- [ ] Start new shadow chat → send message → reply within 5s
- [ ] Switch to /buddy → continue conversation
- [ ] Generate decision report → streams to completion
- [ ] Open execution page → items rendered

## 3. Report bugs
GitHub Issues with label:
- `P0-blocker` — flow completely broken
- `P1-major` — degraded but works
- `P2-ux` — polish issue
- `feature` — new request

Include: browser, time, steps to repro, screenshot.
```

---

## Phase 10 — Observability

### 10.1 Sentry verification

In backend, add a test endpoint (remove after verifying):

```python
@app.get("/sentry-debug")
async def sentry_debug():
    raise ValueError("Sentry test")
```

Hit it once, confirm error appears in Sentry dashboard, then delete.

### 10.2 Railway logs

Railway dashboard → service → **Logs** tab. Pin this for the team.

### 10.3 Cost guardrails

- OpenAI dashboard → **Usage limits** → set monthly hard cap (e.g. $50 for internal beta)
- Supabase → **Project Settings → Billing** → email alert at $X
- Upstash → free tier limit visible in dashboard

### 10.4 Key metrics to watch (week 1)

| Metric | Target | Where to check |
|---|---|---|
| `/health` uptime | 99%+ | Railway |
| Report gen p95 latency | <30s | Sentry Performance |
| Error rate | <2% | Sentry Issues |
| OpenAI daily cost | <$5 internal | OpenAI dashboard |
| Concurrent active users | up to 5 | Supabase Auth |

---

## Phase 11 — CI/CD

### 11.1 GitHub Actions

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main, staging]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Install uv
        run: pip install uv
      - name: Install deps
        run: uv pip install --system .
      - name: Smoke import
        run: python -c "from foresight_x.ui.api_server import app; print('import ok')"
      - name: Run tests
        run: python -m pytest -q || echo "no tests yet"

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: web/package-lock.json }
      - run: cd web && npm ci
      - run: cd web && npm run build
      - run: cd web && npm run lint || echo "no lint yet"

  smoke:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    needs: [backend, frontend]
    steps:
      - run: |
          curl -fsS https://foresight-x-api.up.railway.app/health
          curl -fsS https://foresight-x.vercel.app
```

### 11.2 Auto-deploy

Railway and Vercel both auto-deploy on push to `main`. No extra config needed.

### 11.3 Preview deploys

Vercel auto-creates preview URLs for every PR. Add the preview URL pattern to Supabase redirect URLs (Phase 8.1).

---

## Phase 12 — Smoke Test

### 12.1 Tag the release

```bash
git checkout main
git pull
git tag v0.1.0-internal-beta
git push origin v0.1.0-internal-beta
```

### 12.2 5-flow test (every tester runs this)

1. **Login** — magic link → `/` loads, no console errors
2. **Shadow chat** — `/` → new thread → send "Should I take a gap year?" → reply within 5s
3. **Buddy/Reflect** — `/buddy` → ongoing conversation → memory recalled
4. **Decision report** — trigger from a thread → streaming UI shows phases → final report renders
5. **Execution page** — items list, mark one as done, refresh, persists

### 12.3 Concurrent test

All 5 testers log in at the same time, run flow 4 simultaneously. Watch:
- Sentry for spikes
- Railway CPU/memory
- Supabase pooler connections

If anyone's report fails, that's a P0.

### 12.4 Rollback drill

```bash
# If main breaks:
git checkout v0.1.0-internal-beta
# Railway → Deployments → click previous deploy → Redeploy
# Vercel → Deployments → click previous deploy → Promote to Production
```

Should restore service in <2 min.

---

## Troubleshooting

### CORS errors in browser
Check both:
- `ALLOWED_ORIGINS` matches your production Vercel URL exactly (including `https://`, no trailing slash)
- `CORS_PREVIEW_REGEX` matches preview domains (replace `yourteam` with your real Vercel team slug)

After any CORS env change, redeploy backend.

### 401 on every API call
JWT secret mismatch. In Supabase: Settings → API → JWT → copy the **JWT Secret** (not anon key) into Railway `SUPABASE_JWT_SECRET`.

### Chroma data lost on redeploy
Volume not mounted. Railway → Settings → Volumes → confirm `/data` mount, and `CHROMA_PERSIST_DIR=/data/chroma` in env.

### Magic link redirects to localhost in production
Supabase → Authentication → URL Configuration → fix Site URL.

### Slow first request after idle
Railway free tier sleeps. Upgrade to Hobby ($5/mo) or hit `/health` every 5 min from a free uptime monitor (UptimeRobot).

### Redis connection errors
Upstash URL must use `rediss://` (note the double `s`, TLS). Confirm region matches Railway region.

### Reports time out
Use the streaming endpoint (Phase 5.2). If single-shot, raise Railway request timeout in `railway.json`.

---

## Definition of Done

- [ ] All 5 testers logged in with magic link
- [ ] Each tester completed the 5-flow test
- [ ] No P0 issues open
- [ ] Sentry catching errors (verified with debug endpoint)
- [ ] Rollback drill executed once
- [ ] CI passing on `main`
- [ ] `v0.1.0-internal-beta` tag pushed
- [ ] Tester guide shared in team channel
- [ ] Cost dashboards bookmarked

When all checkboxes pass for 3 consecutive days → ready for external pilot.

---

## Quick Reference (Pin This)

| Resource | URL |
|---|---|
| Frontend | https://foresight-x.vercel.app |
| Backend | https://foresight-x-api.up.railway.app |
| Supabase | https://supabase.com/dashboard/project/xxxxx |
| Upstash | https://console.upstash.com |
| Railway | https://railway.app/project/xxxxx |
| Vercel | https://vercel.com/yourteam/foresight-x |
| Sentry BE | https://sentry.io/organizations/yourorg/projects/foresight-x-backend |
| Sentry FE | https://sentry.io/organizations/yourorg/projects/foresight-x-frontend |
| GitHub | https://github.com/yourorg/foresight-x |
