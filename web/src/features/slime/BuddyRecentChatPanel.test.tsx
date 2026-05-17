import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyRecentChatPanel } from './BuddyRecentChatPanel';

describe('BuddyRecentChatPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('starts collapsed when no saved preference', () => {
    const html = renderToStaticMarkup(
      <BuddyRecentChatPanel
        threadId="thread-1"
        storageUserId="user-a"
        onOpenFullChat={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Expand recent chat"');
    expect(html).not.toContain('Recent chat');
    expect(html).toContain('w-11');
  });
});
