import { describe, expect, it } from 'vitest';
import {
  estimateThreadMessageCount,
  findReusableDraftThread,
  isDraftThread,
  resolveThreadSlimeType,
  type NewChatThreadLike,
} from './newChatGuard';

describe('newChatGuard', () => {
  it('resolves slime type with fallback', () => {
    expect(resolveThreadSlimeType({ thread_id: 'a', slime_type: 'wellbeing' })).toBe('wellbeing');
    expect(resolveThreadSlimeType({ thread_id: 'b', slimeType: 'generalized' })).toBe('generalized');
    expect(resolveThreadSlimeType({ thread_id: 'c' })).toBe('generalized');
  });

  it('estimates message count from summary or full thread payload', () => {
    expect(estimateThreadMessageCount({ thread_id: 'a', message_count: 4 })).toBe(4);
    expect(estimateThreadMessageCount({ thread_id: 'b', messages: [{}, {}] })).toBe(2);
    expect(estimateThreadMessageCount({ thread_id: 'c' })).toBe(0);
  });

  it('treats untitled empty threads as drafts only', () => {
    expect(isDraftThread({ thread_id: '1', title: 'New chat', message_count: 0 }, 'generalized')).toBe(true);
    expect(isDraftThread({ thread_id: '2', title: 'Therapy session', message_count: 0, slime_type: 'wellbeing' }, 'wellbeing')).toBe(true);
    expect(isDraftThread({ thread_id: '3', title: 'Budget planning', message_count: 0 }, 'generalized')).toBe(false);
    expect(isDraftThread({ thread_id: '4', title: 'New chat', message_count: 1 }, 'generalized')).toBe(false);
  });

  it('picks the most recent reusable draft thread', () => {
    const threads: NewChatThreadLike[] = [
      { thread_id: 'old', title: 'New chat', message_count: 0, updated_at: '2026-01-01T00:00:00Z' },
      { thread_id: 'used', title: 'Project', message_count: 3, updated_at: '2026-05-01T00:00:00Z' },
      { thread_id: 'new', title: 'New chat', message_count: 0, updated_at: '2026-06-01T00:00:00Z' },
    ];
    expect(findReusableDraftThread(threads, 'generalized')?.thread_id).toBe('new');
    expect(findReusableDraftThread(threads, 'wellbeing')).toBeNull();
  });
});
