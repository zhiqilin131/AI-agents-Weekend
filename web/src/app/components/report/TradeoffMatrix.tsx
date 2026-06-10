import type { FeatureAudit } from '../../../utils/featureAudit';
import {
  MATRIX_KEY_LABELS,
  coverageBadgeClass,
  discriminationLabel,
  featureMatrixKeys,
  statusBadgeClass,
} from '../../../utils/featureAudit';

interface TradeoffMatrixProps {
  audit: FeatureAudit;
  optionNames?: Record<string, string>;
}

export function TradeoffMatrix({ audit, optionNames = {} }: TradeoffMatrixProps) {
  const vectors = audit.feature_vectors ?? [];
  if (!vectors.length) return null;

  const coverage = audit.grounded_feature_coverage ?? 0;
  const disc = audit.cross_option_discrimination;
  const keys = featureMatrixKeys();

  return (
    <section
      className="rounded-2xl border border-slate-200/60 bg-gradient-to-b from-white/95 to-slate-50/40 p-4 shadow-sm"
      data-testid="tradeoff-matrix"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] tracking-tight text-slate-800" style={{ fontWeight: 600 }}>
            Tradeoff matrix
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">{discriminationLabel(disc)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${coverageBadgeClass(coverage)}`}
          >
            {Math.round(coverage * 100)}% grounded
          </span>
          {typeof disc === 'number' ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200/60 ring-inset">
              {Math.round(disc * 100)}% spread
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-1.5 pr-2 text-left font-medium text-slate-500">Option</th>
              {keys.map((k) => (
                <th key={k} className="px-1 py-1.5 text-center font-medium text-slate-500">
                  {MATRIX_KEY_LABELS[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vectors.map((fv) => {
              const oid = String(fv.option_id ?? '');
              const statuses = (fv.field_status ?? {}) as Record<string, string>;
              return (
                <tr key={oid} className="border-b border-slate-50">
                  <td className="max-w-[120px] truncate py-1.5 pr-2 font-medium text-slate-700">
                    {optionNames[oid] ?? oid}
                  </td>
                  {keys.map((k) => {
                    const st = statuses[k] ?? 'unknown';
                    const lv = String(fv[k] ?? '—');
                    return (
                      <td key={`${oid}-${k}`} className="px-1 py-1.5 text-center">
                        <span
                          className={`inline-block rounded px-1 py-px text-[9px] uppercase tracking-wide ring-1 ring-inset ${statusBadgeClass(st)}`}
                          title={`${k}: ${lv}`}
                        >
                          {st === 'known' ? lv.slice(0, 3) : st.slice(0, 4)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
