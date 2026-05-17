import { describe, expect, it } from 'vitest';
import { dedupeOverlappingCalendarEvents, eventsTimeOverlap } from './executionCalendarDedupe';
import type { CalendarEvent } from './executionScheduler';

function aiEvent(id: string, title: string, start: string, end: string): CalendarEvent {
  return { id, title, start, end, source: 'ai' };
}

describe('eventsTimeOverlap', () => {
  it('detects overlapping intervals', () => {
    const a = aiEvent('a', 'A', '2026-05-18T09:00:00.000Z', '2026-05-18T10:00:00.000Z');
    const b = aiEvent('b', 'B', '2026-05-18T09:30:00.000Z', '2026-05-18T10:30:00.000Z');
    expect(eventsTimeOverlap(a, b)).toBe(true);
  });

  it('allows adjacent non-overlapping intervals', () => {
    const a = aiEvent('a', 'A', '2026-05-18T09:00:00.000Z', '2026-05-18T10:00:00.000Z');
    const b = aiEvent('b', 'B', '2026-05-18T10:00:00.000Z', '2026-05-18T11:00:00.000Z');
    expect(eventsTimeOverlap(a, b)).toBe(false);
  });
});

describe('dedupeOverlappingCalendarEvents', () => {
  it('drops stacked ai blocks on the same slot', () => {
    const events = [
      aiEvent('1', 'Deep work', '2026-05-18T09:00:00.000Z', '2026-05-18T10:00:00.000Z'),
      aiEvent('2', 'Other task', '2026-05-18T09:15:00.000Z', '2026-05-18T10:15:00.000Z'),
    ];
    expect(dedupeOverlappingCalendarEvents(events)).toHaveLength(1);
  });

  it('drops duplicate ai titles', () => {
    const events = [
      aiEvent('1', 'Deep work', '2026-05-18T09:00:00.000Z', '2026-05-18T10:00:00.000Z'),
      aiEvent('2', 'Deep work', '2026-05-18T14:00:00.000Z', '2026-05-18T15:00:00.000Z'),
    ];
    expect(dedupeOverlappingCalendarEvents(events)).toHaveLength(1);
  });

  it('keeps manual events even when they overlap ai blocks', () => {
    const events: CalendarEvent[] = [
      aiEvent('1', 'Deep work', '2026-05-18T09:00:00.000Z', '2026-05-18T10:00:00.000Z'),
      {
        id: 'm1',
        title: 'Call',
        start: '2026-05-18T09:30:00.000Z',
        end: '2026-05-18T10:00:00.000Z',
        source: 'manual',
      },
    ];
    expect(dedupeOverlappingCalendarEvents(events)).toHaveLength(2);
  });
});
