import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessageList } from './ChatMessageList';

describe('ChatMessageList (shadow)', () => {
  it('does not render profile memory saves in the transcript (toasts live in ShadowChatShell)', () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[{ id: '1', role: 'user', content: 'Hi' }]}
        onOpenReportArtifact={() => {}}
        onReviseArtifact={() => {}}
        onArtifactExecutionCalendar={() => {}}
      />,
    );
    expect(html).not.toContain('Saved to profile memory');
    expect(html).toContain('Hi');
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
