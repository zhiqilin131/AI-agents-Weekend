import { describe, expect, it } from 'vitest';
import { isSafetyEscalationMessage } from './safetyEscalation';

describe('isSafetyEscalationMessage', () => {
  it('flags suicide and self-harm language', () => {
    expect(isSafetyEscalationMessage('I want to kill myself')).toBe(true);
    expect(isSafetyEscalationMessage('thinking about self harm')).toBe(true);
  });

  it('does not flag panic breathing without medical red flags', () => {
    expect(isSafetyEscalationMessage("I'm panicking and can't breathe")).toBe(false);
  });

  it('flags medical chest pain with breathing trouble', () => {
    expect(isSafetyEscalationMessage("chest pain and I can't breathe")).toBe(true);
  });
});
