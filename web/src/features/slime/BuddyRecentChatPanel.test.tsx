import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyRecentChatPanel } from './BuddyRecentChatPanel';

describe('BuddyRecentChatPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ threads: [] }),
        }),
      ),
    );
  });

  it('starts collapsed when no saved preference', () => {
    const html = renderToStaticMarkup(
      <BuddyRecentChatPanel
        activeThreadId="thread-1"
        storageUserId="user-a"
        onSelectThread={() => {}}
        onStartNewChat={() => {}}
        onOpenFullChat={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Expand recent chat"');
    expect(html).not.toContain('Recent chat');
    expect(html).toContain('w-11');
  });

  it('lists generalized threads when expanded', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => '0'),
      setItem: vi.fn(),
    });
    const html = renderToStaticMarkup(
      <BuddyRecentChatPanel
        activeThreadId="t-2"
        storageUserId="user-a"
        onSelectThread={() => {}}
        onStartNewChat={() => {}}
        onOpenFullChat={() => {}}
      />,
    );
    expect(html).toContain('Recent chat');
    expect(html).toContain('New chat');
    expect(html).toContain('Continue in Chat');
  });
});
