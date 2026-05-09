export function ScheduleAlternatives({
  alternatives,
  busy,
  onPick,
}: {
  alternatives: Array<{ label: string; tradeoff_summary?: string; score?: number }>;
  busy?: boolean;
  onPick: (index: number) => void;
}) {
  if (!alternatives.length) return null;
  const shown = alternatives.slice(0, 3);
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800/90">Other options</p>
      <div className="flex flex-wrap gap-2">
        {shown.map((a, i) => (
          <button
            key={`${a.label}-${i}`}
            type="button"
            disabled={busy}
            onClick={() => onPick(i)}
            className="rounded-full border border-indigo-200/90 bg-white/90 px-3 py-1.5 text-left text-[11px] font-medium text-indigo-950 shadow-sm hover:bg-indigo-50 disabled:opacity-50"
          >
            <span className="font-semibold">{a.label}</span>
            {a.tradeoff_summary ? <span className="mt-0.5 block text-[10px] font-normal text-slate-600">{a.tradeoff_summary}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
