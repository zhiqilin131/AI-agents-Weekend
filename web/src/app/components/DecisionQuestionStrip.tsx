import type { DecisionReport } from '../model';

interface DecisionQuestionStripProps {
  /** What the user typed in the textarea. */
  decisionInput: string;
  /** Mapped report (may be partial while streaming). */
  report: DecisionReport | null;
}

/**
 * Full-width strip: user question on top; clarified analysis text when it differs.
 */
export function DecisionQuestionStrip({ decisionInput, report }: DecisionQuestionStripProps) {
  const raw = decisionInput.trim();
  if (!raw) return null;

  const situation = report?.situation?.trim();
  const showClarified = Boolean(situation) && situation.trim() !== raw;

  return (
    <section className="w-full rounded-2xl border border-white/90 bg-white/75 backdrop-blur-sm px-5 py-4 shadow-sm mb-6">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2" style={{ fontWeight: 700 }}>
        Your decision
      </p>
      <p className="text-base text-gray-900 whitespace-pre-wrap leading-relaxed" style={{ fontWeight: 500 }}>
        {raw}
      </p>
      {showClarified && situation && (
        <div className="mt-4 pt-4 border-t border-gray-200/80">
          <p className="text-[11px] uppercase tracking-wider text-purple-700 mb-1.5" style={{ fontWeight: 700 }}>
            Clarified for analysis
          </p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed" style={{ fontWeight: 500 }}>
            {situation}
          </p>
        </div>
      )}
    </section>
  );
}
