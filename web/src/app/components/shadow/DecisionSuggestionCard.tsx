import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import type { ShadowSuggestion } from './types';

export function DecisionSuggestionCard({
  suggestion,
  onGenerate,
  onKeep,
  disabled = false,
  confirmLabel = 'Generate Decision Report',
}: {
  suggestion: ShadowSuggestion | null;
  onGenerate: () => void;
  onKeep: () => void;
  disabled?: boolean;
  confirmLabel?: string;
}) {
  if (!suggestion || suggestion.type !== 'decision_report') return null;
  const manual = confirmLabel === 'Yes';
  return (
    <div
      className={
        manual
          ? 'rounded-2xl border border-sky-300/90 bg-gradient-to-br from-sky-50/95 to-indigo-50/85 p-4 shadow-[0_0_22px_rgba(56,189,248,0.18)]'
          : 'rounded-2xl border border-amber-200 bg-amber-50/90 p-4'
      }
    >
      <p className="text-sm font-semibold text-amber-900">{suggestion.title}</p>
      <p className="mt-1 text-sm text-amber-800">{suggestion.message}</p>
      <div className="mt-3 flex gap-2">
        <BuddyTooltip content="Start the structured decision pipeline — options, trade-offs, risks, and a plan from this thread.">
          <button
            type="button"
            disabled={disabled}
            className="rounded-full bg-indigo-600 px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onGenerate();
            }}
          >
            {confirmLabel}
          </button>
        </BuddyTooltip>
        <button
          type="button"
          disabled={disabled}
          className="rounded-full border border-gray-300 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onKeep();
          }}
        >
          Keep Chatting
        </button>
      </div>
    </div>
  );
}
