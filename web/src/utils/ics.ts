import { format } from 'date-fns';
import type { CalendarEvent } from './executionScheduler';

function parseIcsDate(raw: string, forceUtc: boolean): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  // YYYYMMDDTHHMMSSZ
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    if (v.endsWith('Z') || forceUtc) {
      const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
      if (!Number.isNaN(dt.getTime())) return dt.toISOString();
    }
    // Keep local floating-time events local so they stay on expected weekday in UI.
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  }
  // YYYYMMDD all-day fallback
  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) {
    const [, y, mo, day] = d;
    return `${y}-${mo}-${day}T09:00:00`;
  }
  return null;
}

export function parseIcsToCalendarEvents(icsText: string): CalendarEvent[] {
  const lines = (icsText || '').split(/\r?\n/);
  const events: CalendarEvent[] = [];
  let inEvent = false;
  let cur: Record<string, string> = {};
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      const start = parseIcsDate(cur.DTSTART || '', cur.DTSTART_IS_UTC === '1');
      const end = parseIcsDate(cur.DTEND || '', cur.DTEND_IS_UTC === '1');
      if (start && end) {
        events.push({
          id: cur.UID || `upl-${events.length + 1}`,
          title: cur.SUMMARY || 'Imported event',
          start,
          end,
          source: 'uploaded',
          description: cur.DESCRIPTION || '',
          locked: true,
        });
      }
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const rawKey = line.slice(0, idx);
    const key = rawKey.split(';')[0];
    const val = line.slice(idx + 1);
    cur[key] = val;
    if (key === 'DTSTART') {
      const hasZ = /Z$/.test(val.trim());
      const hasUtcTzid = /TZID=UTC/i.test(rawKey);
      cur.DTSTART_IS_UTC = hasZ || hasUtcTzid ? '1' : '0';
    }
    if (key === 'DTEND') {
      const hasZ = /Z$/.test(val.trim());
      const hasUtcTzid = /TZID=UTC/i.test(rawKey);
      cur.DTEND_IS_UTC = hasZ || hasUtcTzid ? '1' : '0';
    }
  }
  return events;
}

function toIcsDate(iso: string): string {
  return format(new Date(iso), "yyyyMMdd'T'HHmmss'Z'");
}

export function exportEventsToIcs(events: CalendarEvent[]): string {
  const body = events
    .map((ev) => [
      'BEGIN:VEVENT',
      `UID:${ev.id}`,
      `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
      `DTSTART:${toIcsDate(ev.start)}`,
      `DTEND:${toIcsDate(ev.end)}`,
      `SUMMARY:${ev.title}`,
      `DESCRIPTION:${(ev.description || '').replace(/\n/g, '\\n')}`,
      'END:VEVENT',
    ].join('\n'))
    .join('\n');
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Foresight-X//Execution Planner//EN\n${body}\nEND:VCALENDAR\n`;
}
