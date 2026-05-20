import { normalizeSlimeType, type SlimeType } from './slimeIdentity';

export type NewChatThreadLike = {
  thread_id: string;
  title?: string;
  slime_type?: string;
  slimeType?: string;
  message_count?: number;
  messages?: Array<unknown>;
  updated_at?: string;
  created_at?: string;
};

const GENERALIZED_DRAFT_TITLES = new Set(['', 'new chat', 'chat', 'untitled']);
const WELLBEING_DRAFT_TITLES = new Set(['', 'therapy session', 'session', 'untitled']);

function normalizeTitle(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function resolveThreadSlimeType(thread: NewChatThreadLike): SlimeType {
  return normalizeSlimeType(thread.slime_type ?? thread.slimeType) ?? 'generalized';
}

export function estimateThreadMessageCount(thread: NewChatThreadLike): number {
  if (typeof thread.message_count === 'number' && Number.isFinite(thread.message_count)) {
    return Math.max(0, thread.message_count);
  }
  if (Array.isArray(thread.messages)) {
    return thread.messages.length;
  }
  return 0;
}

export function isDraftThread(thread: NewChatThreadLike, slimeType: SlimeType): boolean {
  if (resolveThreadSlimeType(thread) !== slimeType) return false;
  if (estimateThreadMessageCount(thread) > 0) return false;
  const title = normalizeTitle(thread.title);
  const allowed = slimeType === 'wellbeing' ? WELLBEING_DRAFT_TITLES : GENERALIZED_DRAFT_TITLES;
  return allowed.has(title);
}

export function findReusableDraftThread(
  threads: NewChatThreadLike[],
  slimeType: SlimeType,
): NewChatThreadLike | null {
  const draftCandidates = listDraftThreads(threads, slimeType);
  if (draftCandidates.length === 0) return null;
  return [...draftCandidates].sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  })[0];
}

export function listDraftThreads(
  threads: NewChatThreadLike[],
  slimeType: SlimeType,
): NewChatThreadLike[] {
  return threads.filter((thread) => isDraftThread(thread, slimeType));
}
