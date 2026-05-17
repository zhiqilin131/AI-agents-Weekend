import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeExecutionCalendarEvents } from './calendarAgentApi';
import { EXECUTION_CALENDAR_FOCUS_WEEK_KEY, executionStorageKeys } from './executionStorageKeys';

function mockStorage() {
  const mem: Record<string, string> = {};
  const store = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
      clear: () => {
        for (const k of Object.keys(mem)) delete mem[k];
      },
      length: 0,
      key: () => null,
    } as Storage;
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', store);
  return mem;
}

describe('mergeExecutionCalendarEvents', () => {
  beforeEach(() => {
    mockStorage();
  });

  it('maps confirmed events to planner ai blocks and dedupes by id', () => {
    const uid = 'user-abc';
    const k = executionStorageKeys(uid).events;
    localStorage.setItem(
      k,
      JSON.stringify([
        {
          id: 'evt-existing',
          title: 'Old',
          start: '2026-05-17T10:00:00.000Z',
          end: '2026-05-17T11:00:00.000Z',
          source: 'ai',
        },
      ]),
    );

    const added = mergeExecutionCalendarEvents(uid, [
      {
        id: 'evt-existing',
        title: 'Duplicate',
        start: '2026-05-18T10:00:00.000Z',
        end: '2026-05-18T11:00:00.000Z',
        source: 'confirmed',
      },
      {
        id: 'evt-new',
        title: 'Journaling',
        start: '2026-05-18T09:00:00.000Z',
        end: '2026-05-18T09:30:00.000Z',
        source: 'confirmed',
      },
    ]);

    expect(added).toHaveLength(2);
    expect(added.every((e) => e.source === 'ai')).toBe(true);

    const stored = JSON.parse(localStorage.getItem(k) ?? '[]') as Array<{ id: string; source: string }>;
    expect(stored).toHaveLength(2);
    expect(stored.every((e) => e.source === 'ai')).toBe(true);
    expect(stored.some((e) => e.id === 'evt-new')).toBe(true);
    expect(sessionStorage.getItem(EXECUTION_CALENDAR_FOCUS_WEEK_KEY)).toBe('2026-05-18T09:00:00.000Z');
  });
});
