/** Compact outcome visualization: quality meter + key facts — less dl/dt wall of text. */

interface OutcomeLike {
  timestamp: string;
  user_took_recommended_action: boolean;
  actual_outcome: string;
  user_reported_quality: number;
  reversed_later: boolean;
}

export function OutcomeSummaryVisual({ outcome }: { outcome: OutcomeLike }) {
  const q = outcome.user_reported_quality;
  const pct = Math.round((q / 5) * 100);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-50/80 border border-sky-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] uppercase tracking-wide text-sky-900" style={{ fontWeight: 700 }}>
            Outcome quality
          </span>
          <span className="text-lg tabular-nums text-sky-950" style={{ fontWeight: 800 }}>
            {q}<span className="text-sm text-sky-700/80 font-semibold">/5</span>
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-white/80 overflow-hidden border border-sky-100/80">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-gray-50/90 border border-gray-100 px-3 py-2">
          <p className="text-[10px] text-gray-500 uppercase mb-0.5" style={{ fontWeight: 600 }}>
            Followed recommended action
          </p>
          <p className="text-gray-900" style={{ fontWeight: 600 }}>
            {outcome.user_took_recommended_action ? 'Yes' : 'No'}
          </p>
        </div>
        <div className="rounded-xl bg-gray-50/90 border border-gray-100 px-3 py-2">
          <p className="text-[10px] text-gray-500 uppercase mb-0.5" style={{ fontWeight: 600 }}>
            Reversed later
          </p>
          <p className="text-gray-900" style={{ fontWeight: 600 }}>
            {outcome.reversed_later ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white/90 px-3 py-2.5">
        <p className="text-[10px] text-gray-500 uppercase mb-1" style={{ fontWeight: 600 }}>
          What happened
        </p>
        <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">{outcome.actual_outcome}</p>
      </div>

      <p className="text-[10px] text-gray-400 font-mono">Recorded {outcome.timestamp}</p>
    </div>
  );
}
