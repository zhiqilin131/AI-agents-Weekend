/** Synced from AuthContext whenever Supabase session changes; used by ``apiFetch`` for Bearer. */

let accessToken: string | null = null;

export function setAuthAccessToken(token: string | null) {
  accessToken = token;
}

export function getAuthAccessToken(): string | null {
  return accessToken;
}
