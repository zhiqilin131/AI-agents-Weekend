import { scheduleTasksIntoFreeSlots, suggestAlternativeSlot, type CalendarEvent, type ExecutionTask, type SchedulerOptions } from './executionScheduler';

export { scheduleTasksIntoFreeSlots, suggestAlternativeSlot };
export type { CalendarEvent, ExecutionTask, SchedulerOptions };

export function detectConflicts(event: CalendarEvent, allEvents: CalendarEvent[]): boolean {
  const s = new Date(event.start).getTime();
  const e = new Date(event.end).getTime();
  return allEvents.some((x) => {
    if (x.id === event.id) return false;
    const xs = new Date(x.start).getTime();
    const xe = new Date(x.end).getTime();
    return s < xe && e > xs;
  });
}

