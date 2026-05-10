import { apiUrl } from './apiOrigin';
import {
  getAuthAccessTokenResolved,
  refreshAuthSessionBestEffort,
} from '../auth/authTokenBridge';

/**
 * Like ``fetch(apiUrl(path), init)`` but adds a **fresh** ``Authorization: Bearer`` when Supabase is mounted.
 * On 401 with a token, runs one ``refreshSession`` + retry so long-lived tabs do not lose data after JWT expiry.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url =
    path.startsWith('http://') || path.startsWith('https://') ? path : apiUrl(path);

  const doFetch = async (token: string | null) => {
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let token = await getAuthAccessTokenResolved();
  let res = await doFetch(token);
  if (res.status === 401 && token) {
    await refreshAuthSessionBestEffort();
    token = await getAuthAccessTokenResolved();
    res = await doFetch(token);
  }
  return res;
}
