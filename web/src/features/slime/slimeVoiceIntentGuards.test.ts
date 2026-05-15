import { describe, expect, it } from 'vitest';
import {
  calendarMutationKindFromTranscript,
  isExplicitDecisionModeCommand,
  shouldBypassCalendarMutation,
} from './slimeVoiceIntentGuards';

describe('slimeVoiceIntentGuards', () => {
  it('detects explicit decision mode activation', () => {
    expect(isExplicitDecisionModeCommand('Activate decision mode')).toBe(true);
    expect(isExplicitDecisionModeCommand('start decision mode please')).toBe(true);
  });

  it('does not treat apartment move as calendar update', () => {
    const transcript =
      'Activate decision mode. Shall I move to the new apartment or stay where I am?';
    expect(shouldBypassCalendarMutation(transcript)).toBe(true);
    expect(calendarMutationKindFromTranscript(transcript, false)).toBeNull();
  });

  it('still allows calendar reschedule when context is clear', () => {
    const transcript = 'Move my team standup on the calendar to 3pm tomorrow';
    expect(shouldBypassCalendarMutation(transcript)).toBe(false);
    expect(calendarMutationKindFromTranscript(transcript, false)).toBe('update');
  });
});
