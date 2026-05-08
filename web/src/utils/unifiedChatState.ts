export type UnifiedMode = 'normal' | 'roleplay' | 'decision_report';

export type UnifiedSuggestion = {
  type: 'role_mode' | 'decision_report' | null;
  title: string;
  message: string;
} | null;

export function nextModeFromAction(mode: UnifiedMode, action: string): UnifiedMode {
  if (action === 'enter_role_mode') return 'roleplay';
  if (action === 'exit_role_mode' || action === 'close_decision_report') return 'normal';
  if (action === 'generate_decision_report') return 'decision_report';
  return mode;
}

export function shouldShowSuggestion(suggestion: UnifiedSuggestion): boolean {
  return Boolean(suggestion && suggestion.type);
}

