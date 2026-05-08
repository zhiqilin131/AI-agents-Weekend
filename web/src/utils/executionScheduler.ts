import { addMinutes, addDays, startOfDay, setHours, setMinutes, isBefore, isAfter, parseISO, formatISO } from 'date-fns';

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  source: 'uploaded' | 'ai' | 'manual';
  description?: string;
  locked?: boolean;
};

export type ExecutionTask = {
  id: string;
  title: string;
  duration_minutes: number;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  deadline_hint?: string;
};

export type SchedulerOptions = {
  dayStartHour?: number;
  dayEndHour?: number;
  slotMinutes?: number;
  startDate?: Date;
  days?: number;
  minGapMinutes?: number;
};

export function hasConflict(candidateStart: Date, candidateEnd: Date, events: CalendarEvent[], ignoreEventId?: string): boolean {
  return events.some((ev) => {
    if (ignoreEventId && ev.id === ignoreEventId) return false;
    const s = parseISO(ev.start);
    const e = parseISO(ev.end);
    return candidateStart < e && candidateEnd > s;
  });
}

function isWithinWindow(start: Date, end: Date, dayStartHour: number, dayEndHour: number): boolean {
  const dayStart = setMinutes(setHours(startOfDay(start), dayStartHour), 0);
  const dayEnd = setMinutes(setHours(startOfDay(start), dayEndHour), 0);
  return !isBefore(start, dayStart) && !isAfter(end, dayEnd);
}

export function scheduleTasksIntoFreeSlots(
  tasks: ExecutionTask[],
  existingEvents: CalendarEvent[],
  options: SchedulerOptions = {},
): { scheduled: CalendarEvent[]; unscheduled: ExecutionTask[] } {
  const dayStartHour = options.dayStartHour ?? 9;
  const dayEndHour = options.dayEndHour ?? 22;
  const slotMinutes = options.slotMinutes ?? 30;
  const days = options.days ?? 7;
  const minGapMinutes = options.minGapMinutes ?? 15;
  const now = options.startDate ?? new Date();
  const scheduled: CalendarEvent[] = [];
  const unscheduled: ExecutionTask[] = [];
  const allEvents = [...existingEvents];

  for (const task of tasks) {
    const duration = Math.max(30, Math.ceil(task.duration_minutes / slotMinutes) * slotMinutes);
    let placed = false;
    for (let d = 0; d < days && !placed; d += 1) {
      const day = addDays(now, d);
      let cursor = setMinutes(setHours(startOfDay(day), dayStartHour), 0);
      const dayEnd = setMinutes(setHours(startOfDay(day), dayEndHour), 0);
      while (isBefore(addMinutes(cursor, duration), addMinutes(dayEnd, 1))) {
        const candidateStart = cursor;
        const candidateEnd = addMinutes(candidateStart, duration);
        const gapStart = addMinutes(candidateStart, -minGapMinutes);
        const gapEnd = addMinutes(candidateEnd, minGapMinutes);
        if (
          isWithinWindow(candidateStart, candidateEnd, dayStartHour, dayEndHour) &&
          !hasConflict(candidateStart, candidateEnd, allEvents) &&
          !hasConflict(gapStart, gapEnd, allEvents)
        ) {
          const ev: CalendarEvent = {
            id: `ai-${task.id}`,
            title: task.title,
            start: formatISO(candidateStart),
            end: formatISO(candidateEnd),
            source: 'ai',
            description: task.description,
            locked: false,
          };
          scheduled.push(ev);
          allEvents.push(ev);
          placed = true;
          break;
        }
        cursor = addMinutes(cursor, slotMinutes);
      }
    }
    if (!placed) unscheduled.push(task);
  }

  return { scheduled, unscheduled };
}

export function suggestAlternativeSlot(
  event: CalendarEvent,
  allEvents: CalendarEvent[],
  options: SchedulerOptions = {},
): { start: string; end: string } | null {
  const dayStartHour = options.dayStartHour ?? 9;
  const dayEndHour = options.dayEndHour ?? 22;
  const slotMinutes = options.slotMinutes ?? 30;
  const days = options.days ?? 7;
  const minGapMinutes = options.minGapMinutes ?? 15;
  const startDate = parseISO(event.start);
  const duration = Math.max(30, Math.round((parseISO(event.end).getTime() - startDate.getTime()) / 60000));
  for (let d = 0; d < days; d += 1) {
    const day = addDays(startDate, d);
    let cursor = setMinutes(setHours(startOfDay(day), dayStartHour), 0);
    const dayEnd = setMinutes(setHours(startOfDay(day), dayEndHour), 0);
    while (isBefore(addMinutes(cursor, duration), addMinutes(dayEnd, 1))) {
      const s = cursor;
      const e = addMinutes(s, duration);
      const gs = addMinutes(s, -minGapMinutes);
      const ge = addMinutes(e, minGapMinutes);
      const sameSlot = s.getTime() === parseISO(event.start).getTime() && e.getTime() === parseISO(event.end).getTime();
      if (!sameSlot && !hasConflict(s, e, allEvents, event.id) && !hasConflict(gs, ge, allEvents, event.id)) {
        return { start: formatISO(s), end: formatISO(e) };
      }
      cursor = addMinutes(cursor, slotMinutes);
    }
  }
  return null;
}
