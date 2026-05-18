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

  it('renders SOAP-style section labels and calendar hints', () => {
    const sample = [
      '**Subjective:** Feeling overwhelmed about exams.',
      '',
      '**Plan:**',
      '- Journaling for 10 minutes',
      '- *Calendar hint: Tomorrow morning before breakfast.*',
    ].join('\n');
    const html = renderToStaticMarkup(<>{renderChatMarkdown(sample)}</>);
    expect(html).toContain('<strong');
    expect(html).toContain('Subjective:');
    expect(html).not.toContain('**Subjective:**');
    expect(html).toContain('<em');
    expect(html).toContain('Calendar hint:');
    expect(html).not.toContain('*Calendar hint:');
  });

  it('renders markdown bullet lists', () => {
    const html = renderToStaticMarkup(
      <>{renderChatMarkdown('- First item\n- Second with **bold**')}</>,
    );
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect(html).toContain('<strong');
    expect(html).not.toContain('**bold**');
  });
});
