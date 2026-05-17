import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderChatMarkdown } from './chatMarkdown';

describe('renderChatMarkdown', () => {
  it('renders bold and blockquotes instead of raw markdown', () => {
    const html = renderToStaticMarkup(
      <>{renderChatMarkdown('You turned on **Decision Mode**.\n\n> Should I sleep tonight?\n\nTap **Yes** below.')}</>,
    );
    expect(html).toContain('<strong');
    expect(html).toContain('Decision Mode');
    expect(html).not.toContain('**Decision Mode**');
    expect(html).toContain('<blockquote');
    expect(html).toContain('Should I sleep tonight?');
    expect(html).not.toContain('&gt; Should');
  });
});
