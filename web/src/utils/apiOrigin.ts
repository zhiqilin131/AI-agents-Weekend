/** Backend base URL: `VITE_API_ORIGIN` (preferred) or `VITE_API_BASE_URL` (launch-doc alias). Empty → same-origin `/api` (Vite proxy in dev). */
function resolvedApiOrigin(): string {
  const a = import.meta.env.VITE_API_ORIGIN?.trim();
  const b = import.meta.env.VITE_API_BASE_URL?.trim();
  return (a || b || '').replace(/\/$/, '');
}

/** Prefer direct backend origin in dev (`web/.env.development` → 127.0.0.1:8765) so SSE is not proxied. */
export function apiUrl(path: string): string {
  const origin = resolvedApiOrigin();
  if (origin) {
    return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path;
}

/** Turns browser `TypeError: Failed to fetch` (connection refused, CORS, etc.) into an actionable hint. */
export function apiFetchErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    const m = error.message.toLowerCase();
    if (
      m.includes('failed to fetch') ||
      m.includes('networkerror') ||
      m.includes('load failed') ||
      m.includes('network request failed')
    ) {
      const backend = resolvedApiOrigin();
      if (backend) {
        return `Cannot reach the API at ${backend}. If DevTools shows a CORS error, set Railway env ALLOWED_ORIGINS to your frontend origin (e.g. https://foresight-x.vercel.app), comma-separated if several, then redeploy the backend.`;
      }
      return (
        'Cannot reach the API on port 8765. In a terminal, run `cd web && npm run dev:all` and leave it open ' +
        '(you should see Vite on http://127.0.0.1:5173 and Uvicorn on :8765). ' +
        'Then open http://127.0.0.1:5173 — not :8765. Check with `npm run dev:check`.'
      );
    }
  }
  if (error instanceof Error) return error.message;
  return 'Request failed';
}
