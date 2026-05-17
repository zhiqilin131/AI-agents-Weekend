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

  it('renders assistant **bold** as strong, not literal asterisks', () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            content: 'Tap **Yes** below when ready.\n\n> Should I go?',
          },
        ]}
        onOpenReportArtifact={() => {}}
        onReviseArtifact={() => {}}
        onArtifactExecutionCalendar={() => {}}
      />,
    );
    expect(html).toContain('<strong');
    expect(html).not.toContain('**Yes**');
    expect(html).toContain('<blockquote');
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
