import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  BUDDY_THREAD_LONG_MESSAGE_THRESHOLD,
  buddyThreadMessageCount,
  dismissLongThreadBanner,
  isBuddyThreadLong,
  isLongThreadBannerDismissed,
} from './buddyThreadLimits';
import type { ShadowThread } from '../../app/components/shadow/types';

function threadWithMessages(n: number): ShadowThread {
  return {
    thread_id: 't1',
    title: 'Chat',
    messages: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    })),
  };
}

describe('buddyThreadLimits', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, value: string) {
        this.store[key] = value;
      },
    });
  });

  it('uses threshold of 50', () => {
    expect(BUDDY_THREAD_LONG_MESSAGE_THRESHOLD).toBe(50);
  });

  it('detects long threads above threshold', () => {
    expect(isBuddyThreadLong(threadWithMessages(51))).toBe(true);
    expect(isBuddyThreadLong(threadWithMessages(50))).toBe(false);
    expect(isBuddyThreadLong(threadWithMessages(10))).toBe(false);
  });

  it('counts messages on active thread', () => {
    expect(buddyThreadMessageCount(threadWithMessages(12))).toBe(12);
    expect(buddyThreadMessageCount(null)).toBe(0);
  });

  it('persists dismiss per user and thread', () => {
    dismissLongThreadBanner('user-1', 'thread-a');
    expect(isLongThreadBannerDismissed('user-1', 'thread-a')).toBe(true);
    expect(isLongThreadBannerDismissed('user-1', 'thread-b')).toBe(false);
    expect(isLongThreadBannerDismissed('user-2', 'thread-a')).toBe(false);
  });
});
