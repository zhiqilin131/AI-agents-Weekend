import type { ShadowThread } from '../../app/components/shadow/types';

/** FOR-45: suggest starting a fresh thread when a buddy dialog exceeds this count. */
export const BUDDY_THREAD_LONG_MESSAGE_THRESHOLD = 50;

const DISMISS_STORAGE_PREFIX = 'slimeBuddyLongThreadDismiss';

export function buddyThreadMessageCount(thread: ShadowThread | null | undefined): number {
  if (!thread) return 0;
  const n = thread.messages?.length;
  return typeof n === 'number' && n >= 0 ? n : 0;
}

export function isBuddyThreadLong(thread: ShadowThread | null | undefined): boolean {
  return buddyThreadMessageCount(thread) > BUDDY_THREAD_LONG_MESSAGE_THRESHOLD;
}

function dismissStorageKey(userId: string | null | undefined, threadId: string): string | null {
  const u = userId?.trim();
  const t = threadId.trim();
  if (!u || !t) return null;
  return `${DISMISS_STORAGE_PREFIX}:${u}:${t}`;
}

export function isLongThreadBannerDismissed(
  userId: string | null | undefined,
  threadId: string | null | undefined,
): boolean {
  const k = dismissStorageKey(userId, threadId ?? '');
  if (!k) return false;
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}

export function dismissLongThreadBanner(userId: string | null | undefined, threadId: string): void {
  const k = dismissStorageKey(userId, threadId);
  if (!k) return;
  try {
    localStorage.setItem(k, '1');
  } catch {
    /* ignore */
  }
}
