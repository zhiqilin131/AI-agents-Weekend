import { addMinutes } from 'date-fns';
import { mergeExecutionCalendarEvents, scheduleTextOnExecutionCalendar } from '../../utils/calendarAgentApi';
import { calendarSafeTitle } from './calendarSafeTitle';
import type { TherapyNextAction } from './types';

export function buildLocalCalendarEvent(
  title: string,
  durationMinutes: number,
): Record<string, unknown> {
  const start = addMinutes(new Date(), 10);
  const end = addMinutes(start, Math.max(2, durationMinutes));
  return {
    id: `therapy-lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: calendarSafeTitle(title),
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'manual',
    description: 'Added from Rimumu Therapy Exercise Lab',
  };
}

export async function addTherapyActionToCalendar(
  action: TherapyNextAction,
  storageUserKey: string,
): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const title = calendarSafeTitle(action.calendarTitle ?? action.label);
  const minutes = action.durationMinutes ?? 10;
  const phrase = `${title} for ${minutes} minutes`;
  try {
    const events = await scheduleTextOnExecutionCalendar(phrase, storageUserKey, {
      threadId: null,
    });
    if (events.length) {
      return { ok: true, title: String(events[0]?.title ?? title) };
    }
    mergeExecutionCalendarEvents(storageUserKey, [buildLocalCalendarEvent(title, minutes)]);
    return { ok: true, title };
  } catch (e) {
    try {
      mergeExecutionCalendarEvents(storageUserKey, [buildLocalCalendarEvent(title, minutes)]);
      return { ok: true, title };
    } catch {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not add to calendar' };
    }
  }
}
