import { describe, expect, it } from 'vitest';
import { shouldSurfaceDecisionReportPending, type PendingAction } from './pendingActionTypes';

const decisionPending: PendingAction = {
  id: 'pa-1',
  type: 'decision_report',
  title: 'Turn this into a decision report?',
  message: 'Structure options and trade-offs.',
  blocks: ['generate_decision_report'],
  payload: {},
};

describe('shouldSurfaceDecisionReportPending', () => {
  it('hides decision report pending while report panel is open or complete', () => {
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        reportPanelOpen: true,
      }),
    ).toBe(false);
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        reportComplete: true,
      }),
    ).toBe(false);
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        isReportGenerating: true,
      }),
    ).toBe(false);
  });

  it('hides when thread already has a report artifact', () => {
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        hasReportArtifact: true,
      }),
    ).toBe(false);
  });

  it('still surfaces clarification pending', () => {
    const clar: PendingAction = {
      ...decisionPending,
      type: 'clarification',
      blocks: ['send_message'],
      payload: { questions: [{ id: 'goal', prompt: 'What matters?', options: [] }] },
    };
    expect(
      shouldSurfaceDecisionReportPending(clar, {
        reportPanelOpen: true,
      }),
    ).toBe(true);
  });
});
