import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyLongThreadBanner } from './BuddyLongThreadBanner';

describe('BuddyLongThreadBanner', () => {
  it('renders new chat CTA for generalized slime', () => {
    const html = renderToStaticMarkup(
      <BuddyLongThreadBanner
        slimeType="generalized"
        messageCount={62}
        onStartFresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="buddy-long-thread-banner"');
    expect(html).toContain('This conversation is getting long');
    expect(html).toContain('62 messages');
    expect(html).toContain('New chat');
  });

  it('renders therapy session label for wellbeing', () => {
    const html = renderToStaticMarkup(
      <BuddyLongThreadBanner
        slimeType="wellbeing"
        messageCount={55}
        onStartFresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toContain('New therapy session');
  });
});
