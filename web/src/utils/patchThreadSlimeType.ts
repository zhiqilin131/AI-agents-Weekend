import { normalizeSlimeType, type SlimeType } from '../features/slime/slimeIdentity';
import { apiFetch } from './apiFetch';

/** @deprecated Slime type is immutable per thread after creation. PATCH returns 400. */
export async function patchThreadSlimeType(threadId: string, slimeType: SlimeType): Promise<boolean> {
  const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slime_type: slimeType }),
  });
  return res.ok;
}

export function slimeTypeFromThread(thread: { slime_type?: string; slimeType?: string } | null | undefined): SlimeType {
  const raw = thread?.slime_type ?? thread?.slimeType;
  return normalizeSlimeType(typeof raw === 'string' ? raw : null) ?? 'generalized';
}
