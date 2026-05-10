/** Synced from AuthContext whenever Supabase session changes; used by ``apiFetch`` for Bearer. */

let accessToken: string | null = null;

/** Logged-in Supabase ``user.id`` when present; used to partition client caches (slime profile, etc.). */
let authUserId: string | null = null;

export function setAuthUserId(id: string | null) {
  authUserId = id;
}

export function getAuthUserId(): string | null {
  return authUserId;
}

/** When set (Supabase client mounted), read fresh JWT from storage so long sessions stay valid after auto-refresh. */
let resolveAccessToken: (() => Promise<string | null>) | null = null;

let runRefreshSession: (() => Promise<void>) | null = null;

export function setAuthAccessToken(token: string | null) {
  accessToken = token;
}

export function getAuthAccessToken(): string | null {
  return accessToken;
}

export function registerAuthSessionBridge(
  opts: {
    resolveAccessToken: () => Promise<string | null>;
    refreshSession: () => Promise<void>;
  } | null,
) {
  if (!opts) {
    resolveAccessToken = null;
    runRefreshSession = null;
    return;
  }
  resolveAccessToken = opts.resolveAccessToken;
  runRefreshSession = opts.refreshSession;
}

/** Prefer live ``getSession()`` (post-refresh token); fall back to last synced token. */
export async function getAuthAccessTokenResolved(): Promise<string | null> {
  if (resolveAccessToken) {
    try {
      const t = await resolveAccessToken();
      if (t) return t;
    } catch {
      /* use sync fallback */
    }
  }
  return getAuthAccessToken();
}

export async function refreshAuthSessionBestEffort(): Promise<void> {
  if (!runRefreshSession) return;
  try {
    await runRefreshSession();
  } catch {
    /* caller may still retry with resolved token */
  }
}
