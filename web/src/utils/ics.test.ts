import { describe, expect, it } from 'vitest';
import { exportEventsToIcs, parseIcsToCalendarEvents } from './ics';
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
    ]);
    expect(tasks.length).toBe(2);
    expect(tasks[0].duration_minutes).toBe(60);
    expect(tasks[0].title).toBe('Draft proposal');
  });
});
