import { ClarificationCard, type ClarificationGateMeta } from './ClarificationCard';
import { DecisionSuggestionCard } from './DecisionSuggestionCard';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import type { ClarifyQuestion } from '../ClarifyDialog';
import type { ShadowSuggestion } from './types';
import {
  clarificationFromPendingAction,
  pendingActionToSuggestion,
  type PendingAction,
} from './pendingActionTypes';

type Props = {
  pendingAction: PendingAction | null;
  /** Ephemeral pre-send clarification when thread has no persisted pending yet. */
  fallbackClarification?: {
    questions: ClarifyQuestion[];
    note: string;
    meta?: ClarificationGateMeta | null;
  } | null;
  disabled?: boolean;
  onClarifySkip: () => void;
  onClarifyAnswer: (answers: Record<string, string>, saveToProfile: boolean) => void;
  onGenerateDecisionReport: () => void;
  onDismissSuggestion: () => void;
  onEnterRoleMode?: () => void;
};

export function ThreadActionDock({
  pendingAction,
  fallbackClarification,
  disabled = false,
  onClarifySkip,
  onClarifyAnswer,
  onGenerateDecisionReport,
  onDismissSuggestion,
  onEnterRoleMode,
}: Props) {
  const clar =
    clarificationFromPendingAction(pendingAction) ??
    (fallbackClarification
      ? {
          questions: fallbackClarification.questions,
          note: fallbackClarification.note,
          meta: fallbackClarification.meta ?? null,
        }
      : null);

  const suggestion: ShadowSuggestion | null = pendingActionToSuggestion(pendingAction);

  if (!clar && !suggestion) return null;

  return (
    <div className="space-y-3">
      {clar ? (
        <ClarificationCard
          questions={clar.questions}
          meta={clar.meta}
          disabled={disabled}
          onSkip={onClarifySkip}
          onAnswer={onClarifyAnswer}
        />
      ) : null}
      {suggestion?.type === 'decision_report' ? (
        <DecisionSuggestionCard
          suggestion={suggestion}
          disabled={disabled}
          confirmLabel={
            pendingAction?.payload?.manual_mode === true ? 'Yes' : 'Generate Decision Report'
          }
          onGenerate={onGenerateDecisionReport}
          onKeep={onDismissSuggestion}
        />
      ) : null}
      {suggestion?.type === 'role_mode' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
          <p className="text-sm font-semibold text-amber-900">{suggestion.title}</p>
          <p className="mt-1 text-sm text-amber-800">{suggestion.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onEnterRoleMode ? (
              <BuddyTooltip content="Switch this thread into role-play mode while keeping chat history.">
                <button
                  type="button"
                  disabled={disabled}
                  className="rounded-full bg-indigo-600 px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onEnterRoleMode}
                >
                  Enter Role Mode
                </button>
              </BuddyTooltip>
            ) : null}
            <BuddyTooltip content="Dismiss the suggestion and continue normal chat.">
              <button
                type="button"
                className="rounded-full border border-gray-300 px-4 py-2 text-xs"
                onClick={onDismissSuggestion}
              >
                Continue Normally
              </button>
            </BuddyTooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
}
