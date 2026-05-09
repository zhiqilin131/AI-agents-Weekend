# Foresight-X web (Vite + React)

## Connect to the API (local)

1. **Recommended:** run API + Vite together from `web/`:

   ```bash
   npm run dev:all
   ```

   Vite serves on `http://127.0.0.1:5173` and proxies `/api/*` → `http://127.0.0.1:8765`.  
   Do **not** set `VITE_API_ORIGIN` in this mode unless you want to bypass the proxy.

2. **API only on another host/port:** create `web/.env.development` (see `.env.example`) and set:

   ```bash
   VITE_API_ORIGIN=http://127.0.0.1:8765
   ```

## Backend CORS

FastAPI reads **`ALLOWED_ORIGINS`** (comma-separated exact origins). Your browser origin must be listed, e.g.:

```bash
ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

For Vercel preview URLs you can set **`CORS_PREVIEW_REGEX`** (see repo root `.env.example`).

## Production split (Vercel + Railway)

- Vercel: set **`VITE_API_ORIGIN`** = public API base URL (no trailing slash).
- Railway (backend): set **`ALLOWED_ORIGINS`** = your Vercel production URL (and previews if needed).

Auth-heavy routes (`/api/me`, `/api/threads`) require Supabase JWT — see `FORESIGHT_X_LAUNCH.md`. Shadow chat file APIs stay on `/api/shadow-chat/*` unless you migrate them.
