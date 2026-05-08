type Suggestion = {
  type: 'role_mode' | 'decision_report' | null;
  title: string;
  message: string;
};

export function ModeSuggestionBanner({
  suggestion,
  onEnterRoleMode,
  onGenerateDecisionReport,
  onContinue,
  onDismiss,
}: {
  suggestion: Suggestion | null;
  onEnterRoleMode: () => void;
  onGenerateDecisionReport: () => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  if (!suggestion) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 space-y-3">
      <p className="text-sm font-semibold text-amber-900">{suggestion.title}</p>
      <p className="text-sm text-amber-800">{suggestion.message}</p>
      <div className="flex flex-wrap gap-2">
        {suggestion.type === 'role_mode' ? (
          <>
            <button type="button" className="rounded-full bg-indigo-600 px-4 py-2 text-xs text-white" onClick={onEnterRoleMode}>
              Enter Role Mode
            </button>
            <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-xs" onClick={onContinue}>
              Continue Normally
            </button>
            <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-xs" onClick={onDismiss}>
              Don&apos;t Ask Again
            </button>
          </>
        ) : (
          <>
            <button type="button" className="rounded-full bg-indigo-600 px-4 py-2 text-xs text-white" onClick={onGenerateDecisionReport}>
              Generate Decision Report
            </button>
            <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-xs" onClick={onContinue}>
              Keep Chatting
            </button>
          </>
        )}
      </div>
    </div>
  );
}

