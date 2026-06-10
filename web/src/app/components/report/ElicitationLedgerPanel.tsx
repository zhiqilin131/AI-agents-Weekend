import type { ElicitationRound } from '../../../utils/featureAudit';

export function ElicitationLedgerPanel({ rounds }: { rounds: ElicitationRound[] }) {
  if (!rounds.length) return null;
  return (
    <section className="rounded-xl border border-slate-200/60 bg-slate-50/40 px-3 py-2.5 space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Grounding history ({rounds.length} round{rounds.length === 1 ? '' : 's'})
      </h4>
      <ol className="space-y-1.5">
        {rounds.map((r, i) => (
          <li
            key={r.round_id ?? `round-${i}`}
            className="rounded-lg border border-white/80 bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-600"
          >
            <span className="font-medium text-slate-800">
              Round {i + 1}
              {r.source ? ` · ${r.source}` : ''}
            </span>
            <span className="ml-2 text-slate-500">
              {typeof r.coverage_before === 'number' ? `${Math.round(r.coverage_before * 100)}%` : '—'}
              {' → '}
              {typeof r.coverage_after === 'number' ? `${Math.round(r.coverage_after * 100)}%` : '—'} grounded
              {typeof r.discrimination_after === 'number'
                ? ` · ${Math.round(r.discrimination_after * 100)}% spread`
                : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
