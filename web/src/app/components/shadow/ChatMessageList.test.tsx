import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessageList } from './ChatMessageList';

describe('ChatMessageList (shadow)', () => {
  it('renders profile memory log entries in-chat', () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[{ id: '1', role: 'user', content: 'Hi' }]}
        memoryLog={[{ kind: 'profile_update', items: ['Went to Target today'], at: '2026-05-08T12:00:00Z' }]}
        onOpenReportArtifact={() => {}}
        onReviseArtifact={() => {}}
        onArtifactExecutionCalendar={() => {}}
      />,
    );
    expect(html).toContain('Saved to profile memory');
    expect(html).toContain('Went to Target today');
  });

  it('shows empty-state prompt and suggestion chips without calling API', () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[]}
        onOpenReportArtifact={() => {}}
        onReviseArtifact={() => {}}
        onArtifactExecutionCalendar={() => {}}
        onSuggestionChip={() => {}}
      />,
    );
    expect(html).toContain('What are we thinking through today?');
    expect(html).toContain('Help me decide something concrete');
    expect(html).toContain('no clarification until you send');
  });
});
