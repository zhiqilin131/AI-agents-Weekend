import { describe, expect, it } from 'vitest';
import { sortThreadsByRecent } from './buddyThreadSort';

describe('sortThreadsByRecent', () => {
  it('orders newest updated_at first', () => {
    const sorted = sortThreadsByRecent([
      { thread_id: 'old', updated_at: '2026-01-01T00:00:00Z' },
      { thread_id: 'new', updated_at: '2026-05-19T12:00:00Z' },
      { thread_id: 'mid', updated_at: '2026-03-01T00:00:00Z' },
    ]);
    expect(sorted.map((t) => t.thread_id)).toEqual(['new', 'mid', 'old']);
  });

  it('falls back to created_at when updated_at ties', () => {
    const sorted = sortThreadsByRecent([
      { thread_id: 'a', updated_at: '2026-05-01T00:00:00Z', created_at: '2026-04-01T00:00:00Z' },
      { thread_id: 'b', updated_at: '2026-05-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
    ]);
    expect(sorted.map((t) => t.thread_id)).toEqual(['b', 'a']);
  });
});
