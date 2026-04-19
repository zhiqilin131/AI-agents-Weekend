/** Prefer direct backend origin in dev (see `.env.development`) so SSE is not proxied. */
export function apiUrl(path: string): string {
  const origin = import.meta.env.VITE_API_ORIGIN?.trim();
  if (origin) {
    return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path;
}
