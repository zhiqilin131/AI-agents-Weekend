import { describe, expect, it } from 'vitest';
import { detectConflicts } from './scheduler';

describe('scheduler utils', () => {
  it('detects overlap conflicts', () => {
    const all = [
      { id: 'a', title: 'A', start: '2026-05-08T10:00:00', end: '2026-05-08T11:00:00', source: 'uploaded' as const },
      { id: 'b', title: 'B', start: '2026-05-08T11:00:00', end: '2026-05-08T12:00:00', source: 'ai' as const },
    ];
    expect(
      detectConflicts(
        { id: 'c', title: 'C', start: '2026-05-08T10:30:00', end: '2026-05-08T11:30:00', source: 'ai' },
        all,
      ),
    ).toBe(true);
  });
});

