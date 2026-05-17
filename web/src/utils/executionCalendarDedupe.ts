import { parseISO } from 'date-fns';
import type { CalendarEvent } from './executionScheduler';

export function normalizeEventTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function eventsTimeOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  try {
    const aStart = parseISO(a.start);
    const aEnd = parseISO(a.end);
    const bStart = parseISO(b.start);
    const bEnd = parseISO(b.end);
    return aStart < bEnd && aEnd > bStart;
  } catch {
    return false;
  }
}

/** Drop duplicate AI blocks (same title) and overlapping AI blocks (stacked on the same slot). */
export function dedupeOverlappingCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seenAiTitles = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const event of events) {
    const titleKey = normalizeEventTitle(event.title);
    if (event.source === 'ai' && titleKey) {
      if (seenAiTitles.has(titleKey)) continue;
      const overlapsExisting = out.some(
        (existing) => existing.source === 'ai' && eventsTimeOverlap(existing, event),
      );
      if (overlapsExisting) continue;
      seenAiTitles.add(titleKey);
    }
    out.push(event);
  }
  return out;
}
