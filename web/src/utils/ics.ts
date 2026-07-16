import { addDays, addMonths, addWeeks, addYears, format } from 'date-fns';
import type { CalendarEvent } from './executionScheduler';

const MAX_RECURRENCE_INSTANCES = 500;

export type IcsSkippedEvent = {
  uid?: string;
  summary?: string;
  reason: string;
};

export type IcsImportResult = {
  events: CalendarEvent[];
  skipped: IcsSkippedEvent[];
};

function unfoldIcsLines(icsText: string): string[] {
  const out: string[] = [];
  for (const raw of (icsText || '').split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && out.length) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function unescapeIcsText(raw: string): string {
  return (raw || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

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
    return `${y}-${mo}-${day}T00:00:00`;
  }
  return null;
}

function isIcsAllDayDate(raw: string): boolean {
  return /^(\d{4})(\d{2})(\d{2})$/.test((raw || '').trim());
}

function parseIsoishDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLike(startIso: string, dt: Date): string {
  if (startIso.endsWith('Z')) return dt.toISOString();
  return format(dt, "yyyy-MM-dd'T'HH:mm:ss");
}

function addByFreq(dt: Date, freq: string, interval: number): Date {
  if (freq === 'DAILY') return addDays(dt, interval);
  if (freq === 'WEEKLY') return addWeeks(dt, interval);
  if (freq === 'MONTHLY') return addMonths(dt, interval);
  if (freq === 'YEARLY') return addYears(dt, interval);
  return dt;
}

function parseRRule(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim().toUpperCase()] = part.slice(idx + 1).trim();
  }
  return out;
}

function expandRecurringEvents(base: CalendarEvent, rruleRaw: string): IcsImportResult {
  if (!rruleRaw.trim()) return { events: [base], skipped: [] };
  const rule = parseRRule(rruleRaw);
  const freq = (rule.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    return {
      events: [base],
      skipped: [{
        uid: base.id,
        summary: base.title,
        reason: `Unsupported recurrence frequency${freq ? `: ${freq}` : ''}`,
      }],
    };
  }

  const start0 = parseIsoishDate(base.start);
  const end0 = parseIsoishDate(base.end);
  if (!start0 || !end0) {
    return { events: [base], skipped: [{ uid: base.id, summary: base.title, reason: 'Invalid recurrence dates' }] };
  }

  const durationMs = end0.getTime() - start0.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { events: [base], skipped: [{ uid: base.id, summary: base.title, reason: 'Invalid recurrence duration' }] };
  }

  const count = rule.COUNT ? Math.max(0, Math.min(Number(rule.COUNT) || 0, MAX_RECURRENCE_INSTANCES)) : 0;
  const until = rule.UNTIL ? parseIcsDate(rule.UNTIL, /Z$/i.test(rule.UNTIL)) : null;
  const untilDate = until ? parseIsoishDate(until) : null;
  const interval = Math.max(1, Math.min(Number(rule.INTERVAL) || 1, 52));
  const cap = count || MAX_RECURRENCE_INSTANCES;
  const events: CalendarEvent[] = [];

  let curStart = start0;
  for (let i = 0; i < cap; i += 1) {
    if (untilDate && curStart.getTime() > untilDate.getTime()) break;
    const curEnd = new Date(curStart.getTime() + durationMs);
    events.push({
      ...base,
      id: i === 0 ? base.id : `${base.id}-r${i + 1}`,
      start: formatLike(base.start, curStart),
      end: formatLike(base.end, curEnd),
    });
    const next = addByFreq(curStart, freq, interval);
    if (next.getTime() === curStart.getTime()) break;
    curStart = next;
  }
  const skipped: IcsSkippedEvent[] = [];
  if (!count && !untilDate && events.length >= MAX_RECURRENCE_INSTANCES) {
    skipped.push({
      uid: base.id,
      summary: base.title,
      reason: `Recurring event capped at ${MAX_RECURRENCE_INSTANCES} instances`,
    });
  }
  return { events: events.length ? events : [base], skipped };
}

function buildEventFromIcsFields(cur: Record<string, string>, fallbackId: string): IcsImportResult {
  const uid = cur.UID || fallbackId;
  const summary = unescapeIcsText(cur.SUMMARY || 'Imported event');
  const start = parseIcsDate(cur.DTSTART || '', cur.DTSTART_IS_UTC === '1');
  let end = parseIcsDate(cur.DTEND || '', cur.DTEND_IS_UTC === '1');
  if (start && !end && isIcsAllDayDate(cur.DTSTART || '')) {
    const startDate = parseIsoishDate(start);
    if (startDate) end = formatLike(start, addDays(startDate, 1));
  }
  if (!start) {
    return { events: [], skipped: [{ uid, summary, reason: 'Missing or invalid DTSTART' }] };
  }
  if (!end) {
    return { events: [], skipped: [{ uid, summary, reason: 'Missing or invalid DTEND' }] };
  }

  const base = {
    id: uid,
    title: summary,
    start,
    end,
    source: 'uploaded',
    description: unescapeIcsText(cur.DESCRIPTION || ''),
    locked: true,
  } satisfies CalendarEvent;
  return expandRecurringEvents(base, cur.RRULE || '');
}

export function parseIcsToCalendarImport(icsText: string): IcsImportResult {
  const lines = unfoldIcsLines(icsText);
  const events: CalendarEvent[] = [];
  const skipped: IcsSkippedEvent[] = [];
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
      const result = buildEventFromIcsFields(cur, `upl-${events.length + skipped.length + 1}`);
      events.push(...result.events);
      skipped.push(...result.skipped);
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
  return { events, skipped };
}

export function parseIcsToCalendarEvents(icsText: string): CalendarEvent[] {
  return parseIcsToCalendarImport(icsText).events;
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
