import { describe, expect, it } from 'vitest';
import {
  REPORT_JOURNEY_STEPS,
  journeyIndexFromProgressLabel,
  journeyStateFromProgress,
} from './reportAgentJourney';

describe('reportAgentJourney', () => {
  it('maps backend progress labels to journey indices', () => {
    expect(journeyIndexFromProgressLabel('Structuring decision')).toBe(0);
    expect(journeyIndexFromProgressLabel('Reading memory')).toBe(1);
    expect(journeyIndexFromProgressLabel('Finalizing report')).toBe(6);
  });

  it('complete panel status fills all steps', () => {
    const s = journeyStateFromProgress('', 'complete');
    expect(s.completedSteps.length).toBe(REPORT_JOURNEY_STEPS.length);
    expect(s.currentStep).toBe('finalizing');
  });

  it('running maps label to current and prior completed', () => {
    const s = journeyStateFromProgress('Generating options', 'running');
    expect(s.currentStep).toBe('options');
    expect(s.completedSteps).toEqual(['structuring', 'memory']);
  });
});
