import { describe, expect, it } from 'vitest';
import { nextModeFromAction, shouldShowSuggestion } from './unifiedChatState';

describe('unified chat state helpers', () => {
  it('updates mode for role mode enter/exit', () => {
    expect(nextModeFromAction('normal', 'enter_role_mode')).toBe('roleplay');
    expect(nextModeFromAction('roleplay', 'exit_role_mode')).toBe('normal');
  });

  it('opens decision mode and can close while preserving normal flow', () => {
    expect(nextModeFromAction('normal', 'generate_decision_report')).toBe('decision_report');
    expect(nextModeFromAction('decision_report', 'close_decision_report')).toBe('normal');
  });

  it('shows suggestion banner only with suggestion type', () => {
    expect(shouldShowSuggestion(null)).toBe(false);
    expect(shouldShowSuggestion({ type: 'role_mode', title: 't', message: 'm' })).toBe(true);
  });
});

