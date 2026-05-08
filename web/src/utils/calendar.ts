import { exportEventsToIcs, parseIcsToCalendarEvents } from './ics';
import type { CalendarEvent } from './scheduler';

export { exportEventsToIcs, parseIcsToCalendarEvents };

export async function parseIcsFile(file: File): Promise<CalendarEvent[]> {
  const text = await file.text();
  return parseIcsToCalendarEvents(text);
}

