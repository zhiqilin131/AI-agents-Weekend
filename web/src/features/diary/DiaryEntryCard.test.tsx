import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiaryEntryCard } from './DiaryEntryCard';
import type { DiaryEntryDto } from './types';

const mockEntry: DiaryEntryDto = {
  id: 'diary_test_entry',
  user_id: 'u1',
  date: '2026-05-09',
  title: 'Small Plans, Bigger Questions',
  summary: 'First paragraph.\n\nSecond paragraph.',
  highlights: ['Calendar planning', 'Companion tone'],
  themes: ['planning'],
  tone: 'reflective',
  action_items: [],
  linked_thread_ids: [],
  linked_message_ids: [],
  linked_decision_ids: [],
  linked_calendar_event_ids: [],
  linked_memory_ids: [],
  linked_import_ids: [],
  source_counts: {
    chat_messages: 84,
    voice_turns: 82,
    reports: 2,
    calendar_items: 1,
    memory_refs: 57,
    imported_items: 2,
  },
  generated_by: 'auto',
  user_edited: false,
  memory_status: 'not_memory',
  memory_indexed: false,
};

describe('DiaryEntryCard', () => {
  it('renders narrative summary and Sources section with counts', () => {
    const html = renderToStaticMarkup(
      <DiaryEntryCard entry={mockEntry} loading={false} apiError={null} onRegenerateCleaner={() => {}} />,
    );
    expect(html).toContain('First paragraph');
    expect(html).toContain('Sources');
    expect(html).toContain('84 chat messages');
    expect(html).toContain('Calendar planning');
    expect(html).toContain('data-testid="diary-regenerate-cleaner"');
  });

  it('omits regenerate button without handler', () => {
    const html = renderToStaticMarkup(<DiaryEntryCard entry={mockEntry} loading={false} apiError={null} />);
    expect(html).not.toContain('diary-regenerate-cleaner');
  });
});
