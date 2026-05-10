import { apiUrl } from './apiOrigin';
import { getAuthAccessToken } from '../auth/authTokenBridge';

/** Like ``fetch(apiUrl(path), init)`` but adds ``Authorization: Bearer`` when a Supabase session exists. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url =
    path.startsWith('http://') || path.startsWith('https://') ? path : apiUrl(path);
  const headers = new Headers(init?.headers);
  const token = getAuthAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
