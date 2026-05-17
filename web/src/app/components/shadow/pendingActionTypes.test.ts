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
  it('hides decision report pending while generating or viewing a finished report', () => {
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        reportPanelOpen: true,
        reportComplete: true,
      }),
    ).toBe(false);
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        isReportGenerating: true,
      }),
    ).toBe(false);
  });

  it('surfaces a new decision after a prior report when the panel is closed', () => {
    expect(
      shouldSurfaceDecisionReportPending(
        { ...decisionPending, payload: { manual_mode: true, decision_prompt: 'Second question?' } },
        { reportComplete: true, hasReportArtifact: true },
      ),
    ).toBe(true);
  });

  it('hides generic offer when thread already has a report artifact', () => {
    expect(
      shouldSurfaceDecisionReportPending(decisionPending, {
        hasReportArtifact: true,
      }),
    ).toBe(false);
  });

  it('keeps manual confirmation when an older report exists on the thread', () => {
    expect(
      shouldSurfaceDecisionReportPending(
        { ...decisionPending, payload: { manual_mode: true, decision_prompt: 'New question?' } },
        { hasReportArtifact: true },
      ),
    ).toBe(true);
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
