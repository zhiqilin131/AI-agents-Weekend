import type { ShadowSuggestion } from './types';

export function DecisionSuggestionCard({
  suggestion,
  onGenerate,
  onKeep,
  disabled = false,
}: {
  suggestion: ShadowSuggestion | null;
  onGenerate: () => void;
  onKeep: () => void;
  disabled?: boolean;
}) {
  if (!suggestion || suggestion.type !== 'decision_report') return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
      <p className="text-sm font-semibold text-amber-900">{suggestion.title}</p>
      <p className="mt-1 text-sm text-amber-800">{suggestion.message}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onGenerate}
        >
          Generate Decision Report
        </button>
        <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-xs" onClick={onKeep}>
          Keep Chatting
        </button>
      </div>
    </div>
  );
}

