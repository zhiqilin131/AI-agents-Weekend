import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionFollowupToast } from './DecisionFollowupToast';

const sample = {
  id: 'fu-1',
  decision_id: 'd1',
  decision_title: 'Join hackathon?',
  decision_prompt: 'Should I join the hackathon?',
  title: 'Mochi check-in',
  body: 'A few weeks ago, you were weighing this decision. Want to record what happened?',
};

describe('DecisionFollowupToast', () => {
  it('renders glass-style notification with actions', () => {
    const html = renderToStaticMarkup(
      <DecisionFollowupToast
        payload={sample}
        onDismiss={vi.fn()}
        onSoftClose={vi.fn()}
        onRecordOutcome={vi.fn()}
        onStillPending={vi.fn()}
        onSnooze={vi.fn()}
      />,
    );
    expect(html).toContain('Mochi check-in');
    expect(html).toContain('Record outcome');
    expect(html).toContain('Still pending');
    expect(html).toContain('backdrop-blur-xl');
    expect(html).toContain('Swipe left to dismiss');
  });
});
