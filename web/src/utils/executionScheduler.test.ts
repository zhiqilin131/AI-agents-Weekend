import { describe, expect, it } from 'vitest';
import { parseISO } from 'date-fns';
import { scheduleTasksIntoFreeSlots, suggestAlternativeSlot, type CalendarEvent, type ExecutionTask } from './executionScheduler';

describe('executionScheduler', () => {
  it('schedules tasks into earliest free slots without conflicts', () => {
    const existing: CalendarEvent[] = [
      {
        id: 'class-1',
        title: 'Class',
        start: '2026-04-28T10:00:00',
        end: '2026-04-28T11:00:00',
        source: 'uploaded',
        locked: true,
      },
    ];
    const tasks: ExecutionTask[] = [
      { id: 't1', title: 'Task 1', duration_minutes: 60 },
      { id: 't2', title: 'Task 2', duration_minutes: 90 },
    ];
    const out = scheduleTasksIntoFreeSlots(tasks, existing, {
      startDate: new Date('2026-04-28T09:00:00'),
      dayStartHour: 9,
      dayEndHour: 22,
      slotMinutes: 30,
      days: 2,
      minGapMinutes: 0,
    });
    expect(out.unscheduled.length).toBe(0);
    expect(out.scheduled.length).toBe(2);
    const baseS = parseISO(existing[0].start);
    const baseE = parseISO(existing[0].end);
    const overlaps = out.scheduled.some((x) => parseISO(x.start) < baseE && parseISO(x.end) > baseS);
    expect(overlaps).toBe(false);
  });

  it('returns unscheduled tasks when no slot fits', () => {
    const existing: CalendarEvent[] = [
      {
        id: 'all-day',
        title: 'Busy',
        start: '2026-04-28T09:00:00',
        end: '2026-04-28T22:00:00',
        source: 'uploaded',
      },
    ];
    const tasks: ExecutionTask[] = [{ id: 't1', title: 'Task 1', duration_minutes: 120 }];
    const out = scheduleTasksIntoFreeSlots(tasks, existing, {
      startDate: new Date('2026-04-28T09:00:00'),
      dayStartHour: 9,
      dayEndHour: 22,
      days: 1,
    });
    expect(out.scheduled.length).toBe(0);
    expect(out.unscheduled.length).toBe(1);
  });

  it('suggests alternative non-conflicting slot', () => {
    const all: CalendarEvent[] = [
      {
        id: 'upload-1',
        title: 'Meeting',
        start: '2026-04-28T10:00:00.000Z',
        end: '2026-04-28T11:00:00.000Z',
        source: 'uploaded',
      },
      {
        id: 'ai-t1',
        title: 'AI task',
        start: '2026-04-28T11:00:00.000Z',
        end: '2026-04-28T12:00:00.000Z',
        source: 'ai',
      },
    ];
    const alt = suggestAlternativeSlot(all[1], all, {
      dayStartHour: 9,
      dayEndHour: 22,
      slotMinutes: 30,
      days: 2,
      minGapMinutes: 0,
    });
    expect(alt).not.toBeNull();
    expect(alt?.start).not.toBe(all[1].start);
  });
});
