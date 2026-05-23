import { describe, expect, it } from 'vitest';
import { exportEventsToIcs, parseIcsToCalendarEvents, parseIcsToCalendarImport } from './ics';
import { mapRecommendationActionsToTasks } from './executionTasks';

describe('ics parser/export and action mapping', () => {
  it('parses uploaded ics events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:ev-1',
      'DTSTART:20260428T130000Z',
      'DTEND:20260428T140000Z',
      'SUMMARY:Lecture',
      'DESCRIPTION:Campus class',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const events = parseIcsToCalendarEvents(text);
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Lecture');
    expect(events[0].source).toBe('uploaded');
  });

  it('expands recurring 2026 calendar events instead of importing only seed events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:weekly-class',
      'DTSTART:20260105T130000Z',
      'DTEND:20260105T140000Z',
      'RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z',
      'SUMMARY:Weekly class',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:monthly-review',
      'DTSTART:20260110T150000Z',
      'DTEND:20260110T160000Z',
      'RRULE:FREQ=MONTHLY;COUNT=12',
      'SUMMARY:Monthly review',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const events = parseIcsToCalendarEvents(text);
    const weekly = events.filter((e) => e.id.startsWith('weekly-class'));
    const monthly = events.filter((e) => e.id.startsWith('monthly-review'));
    expect(weekly.length).toBeGreaterThan(45);
    expect(monthly.length).toBe(12);
    expect(events.some((e) => e.start.startsWith('2026-12'))).toBe(true);
  });

  it('handles folded lines in uploaded ics text', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:folded',
      'DTSTART:20260428T130000Z',
      'DTEND:20260428T140000Z',
      'SUMMARY:Long event title',
      ' DESCRIPTION continuation',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const events = parseIcsToCalendarEvents(text);
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain('continuation');
  });

  it('imports all-day and timezone-field events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:all-day',
      'DTSTART;VALUE=DATE:20260704',
      'SUMMARY:Independence Day',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:tzid-event',
      'DTSTART;TZID=America/New_York:20260910T090000',
      'DTEND;TZID=America/New_York:20260910T100000',
      'SUMMARY:NY morning meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const events = parseIcsToCalendarEvents(text);
    expect(events).toHaveLength(2);
    expect(events[0].start).toBe('2026-07-04T00:00:00');
    expect(events[0].end).toBe('2026-07-05T00:00:00');
    expect(events[1].start).toBe('2026-09-10T09:00:00');
  });

  it('reports skipped events with reasons', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:missing-start',
      'DTEND:20260428T140000Z',
      'SUMMARY:Broken event',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:unsupported-rrule',
      'DTSTART:20260428T130000Z',
      'DTEND:20260428T140000Z',
      'RRULE:FREQ=HOURLY;COUNT=3',
      'SUMMARY:Unsupported recurrence',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const result = parseIcsToCalendarImport(text);
    expect(result.events).toHaveLength(1);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'Missing or invalid DTSTART',
      'Unsupported recurrence frequency: HOURLY',
    ]);
  });

  it('exports ai events to ics text', () => {
    const ics = exportEventsToIcs([
      {
        id: 'ai-1',
        title: 'Deep work',
        start: '2026-04-28T13:00:00.000Z',
        end: '2026-04-28T14:00:00.000Z',
        source: 'ai',
      },
    ]);
    expect(ics.includes('BEGIN:VEVENT')).toBe(true);
    expect(ics.includes('SUMMARY:Deep work')).toBe(true);
  });

  it('maps recommendation.next_actions to execution tasks', () => {
    const tasks = mapRecommendationActionsToTasks([
      { action: 'Draft proposal', deadline: 'Tonight' },
      { action: 'Review with mentor', deadline: null },
      { action: 'Email advisor', deadline: null },
      { action: 'Prepare checklist', deadline: null },
      { action: 'Extra step should not be scheduled', deadline: null },
    ]);
    expect(tasks.length).toBe(4);
    expect(tasks[0].duration_minutes).toBe(90);
    expect(tasks[1].duration_minutes).toBe(45);
    expect(tasks[2].duration_minutes).toBe(30);
    expect(tasks[0].title).toBe('Draft proposal');
    expect(tasks[0].description).toBe('Decision report step 1');
  });
});
