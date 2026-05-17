import { describe, expect, it } from 'vitest';
import {
  canUseWellbeingBuddyVoice,
  wellbeingBuddyGateHint,
} from './therapySession';
import type { ShadowThread } from '../../app/components/shadow/types';

describe('wellbeing buddy gate', () => {
  it('blocks voice without a thread', () => {
    expect(wellbeingBuddyGateHint(false, null)).toMatch(/Recent therapy/);
    expect(canUseWellbeingBuddyVoice(null)).toBe(false);
  });

  it('allows voice when session is active', () => {
    const thread = {
      thread_id: 't1',
      therapy_session: { status: 'active', intake_complete: true },
    } as ShadowThread;
    expect(canUseWellbeingBuddyVoice(thread)).toBe(true);
    expect(wellbeingBuddyGateHint(true, thread)).toBeNull();
  });

  it('prompts to start therapy when intake is done but not active', () => {
    const thread = {
      thread_id: 't2',
      therapy_session: { status: 'not_started', intake_complete: true },
    } as ShadowThread;
    expect(canUseWellbeingBuddyVoice(thread)).toBe(false);
    expect(wellbeingBuddyGateHint(true, thread)).toMatch(/Start therapy below/);
  });
});
