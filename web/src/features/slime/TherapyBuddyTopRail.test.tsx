import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TherapyBuddyTopRail } from './TherapyBuddyTopRail';

vi.mock('./TherapySessionDock', () => ({
  TherapySessionDock: () => <div data-testid="therapy-session-dock-mock" />,
}));

describe('TherapyBuddyTopRail', () => {
  const baseProps = {
    gateHint: 'Choose a session in Recent therapy on the left, or tap + New session.',
    thread: null,
    disabled: false,
    onRequestNewSession: vi.fn(),
    onThreadUpdated: vi.fn(),
    onOpenReport: vi.fn(),
    onOpenCheckIn: vi.fn(),
  };

  it('shows guidance strip only when no thread is selected', () => {
    const withoutThread = renderToStaticMarkup(
      <TherapyBuddyTopRail {...baseProps} threadId={null} />,
    );
    expect(withoutThread).toContain('data-testid="therapy-buddy-gate-banner"');

    const withThread = renderToStaticMarkup(
      <TherapyBuddyTopRail
        {...baseProps}
        threadId="t-new"
        gateHint="Complete your quick check-in, then tap Start therapy below."
      />,
    );
    expect(withThread).not.toContain('data-testid="therapy-buddy-gate-banner"');
  });
});
